import { beforeEach, describe, expect, test, vi } from 'vitest';

import { BOOK_INCOMPLETE, getBookSummary, readBookChunks } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  BOOK_INCOMPLETE: 'BOOK_INCOMPLETE',
  getBookSummary: vi.fn(),
  readBookChunks: vi.fn(),
}));
// bookAudio builds its default client once, at module load, so the fake has to be the same
// object for the whole file rather than something swapped in per test.
const { chunkIndexClient } = vi.hoisted(() => ({
  chunkIndexClient: { readIndex: vi.fn(), readCues: vi.fn() },
}));
vi.mock('@/app/_lib/redisChunkIndex', () => ({
  createChunkIndexClient: () => chunkIndexClient,
}));

const { GET } = await import('./route');

const SECOND = 10_000_000;

function requestFor(bookId, query = '?voice=zh-TW-default') {
  return { url: `https://reader.example/api/books/${bookId}/manifest${query}` };
}

function paramsFor(bookId) {
  return { params: Promise.resolve({ bookId }) };
}

// The Chunk index as Redis holds it: a durations hash, and spans stored per Chunk at
// generation time rather than derived here. Since ticket 17 this is the route's only source,
// so the fixture is the real shape - a fake that knows more than the routes do is what hid
// ticket 17 for a day.
const SEGMENT_ORIGIN = 'https://blob.example/';

// One word per Sentence, relative to the Chunk's own start, which is what the index stores.
const CHUNK_SPANS = [
  { startSeconds: 0, endSeconds: 1 },
  { startSeconds: 2, endSeconds: 3 },
];

function indexed(durations, { spansFor = () => CHUNK_SPANS } = {}) {
  chunkIndexClient.readIndex.mockResolvedValue({ base: SEGMENT_ORIGIN, durations });
  chunkIndexClient.readCues.mockImplementation(async (unused, indexes) =>
    indexes.map((index) => spansFor(index)),
  );
}

// No index at all: since ticket 17 that is an outage rather than an empty Book.
function indexUnavailable() {
  chunkIndexClient.readIndex.mockResolvedValue(undefined);
}

// Unlike the playlist, the manifest genuinely needs the Chunk text: bookManifest counts
// Sentence ordinals from it (see ticket 12).
function bookWithText(chunks) {
  getBookSummary.mockResolvedValueOnce({
    bookId: 'book-1',
    title: 'First Book',
    totalChunks: chunks.length,
  });
  readBookChunks.mockResolvedValueOnce(chunks);
}

describe('GET /api/books/[bookId]/manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns each Chunk's timeline position and its Sentences as absolute spans", async () => {
    bookWithText(['你好。世界。', '你好。世界。']);
    indexed({ 0: 7.5, 1: 4 });

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chunks).toEqual([
      {
        index: 0,
        isGenerated: true,
        startSeconds: 0,
        sentences: [
          { id: 0, startSeconds: 0, endSeconds: 1 },
          { id: 1, startSeconds: 2, endSeconds: 3 },
        ],
      },
      {
        index: 1,
        isGenerated: true,
        startSeconds: 7.5,
        // Offset by the Chunk's startSeconds - one continuous Book timeline.
        sentences: [
          { id: 2, startSeconds: 7.5, endSeconds: 8.5 },
          { id: 3, startSeconds: 9.5, endSeconds: 10.5 },
        ],
      },
    ]);
    expect(chunkIndexClient.readIndex).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-default',
    });
  });

  test('keys the lookup by the requested voice', async () => {
    bookWithText(['你好。']);
    indexed({ 0: 3 });

    await GET(requestFor('book-1', '?voice=zh-TW-HsiaoYuNeural'), paramsFor('book-1'));

    expect(chunkIndexClient.readIndex).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-HsiaoYuNeural',
    });
  });

  // Cues are added as the Book generates, so a stale copy would leave the client
  // permanently short of the Sentences it needs.
  test('forbids caching so a growing Book keeps yielding new cues', async () => {
    bookWithText(['你好。']);
    indexed({});

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  test('returns an empty manifest, not an error, for a Book with nothing generated yet', async () => {
    bookWithText(['你好。', '世界。']);
    indexed({});

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chunks).toEqual([
      { index: 0, isGenerated: false, startSeconds: null, sentences: [] },
      { index: 1, isGenerated: false, startSeconds: null, sentences: [] },
    ]);
  });

  // The client re-points the element at a playlist starting further in when a seek target
  // is past a gap; the cue times have to be rebased onto that same timeline, or every
  // highlight lands at the wrong second (see ticket 07).
  describe('?from', () => {
    test('rebases the timeline on the given Chunk while leaving Sentence ids alone', async () => {
      bookWithText(['你好。世界。', '你好。世界。', '你好。世界。']);
      indexed({ 0: 7.5, 1: 4, 2: 6 });

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=1'),
        paramsFor('book-1'),
      );
      const body = await response.json();

      expect(body.chunks[0]).toEqual({
        index: 0,
        isGenerated: true,
        startSeconds: null,
        sentences: [],
      });
      expect(body.chunks[1]).toEqual({
        index: 1,
        isGenerated: true,
        startSeconds: 0,
        // Ids stay Book-global - a Sentence's identity doesn't depend on where the Book
        // is being played from.
        sentences: [
          { id: 2, startSeconds: 0, endSeconds: 1 },
          { id: 3, startSeconds: 2, endSeconds: 3 },
        ],
      });
      expect(body.chunks[2].startSeconds).toBe(4);
    });

    // No index mock: the Chunk audio is never read, which is the point - an
    // unusable start is rejected before anything touches the store.
    test('rejects a start that names no Chunk in this Book with 400', async () => {
      bookWithText(['你好。']);

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=4'),
        paramsFor('book-1'),
      );

      expect(response.status).toBe(400);
    });
  });

  test('rejects a request with no voice with 400', async () => {
    const response = await GET(requestFor('book-1', ''), paramsFor('book-1'));

    expect(response.status).toBe(400);
  });

  test('returns 404 when the book does not exist', async () => {
    getBookSummary.mockResolvedValueOnce(null);

    const response = await GET(requestFor('missing'), paramsFor('missing'));

    expect(response.status).toBe(404);
  });

  test('returns a 502 when reading the Book fails', async () => {
    getBookSummary.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });

  // A Book the index advertises whose text was never stored. 502 says "try again", and this
  // one can only fail again - so it gets the same 409 /api/library/[bookId] answers (see
  // ticket 06 of phase 1.11). This route always reads the Chunk text, so unlike the playlist
  // it can always tell.
  test('returns 409 when the Book is listed but its text was never stored', async () => {
    getBookSummary.mockResolvedValueOnce({ bookId: 'book-1', title: 'First Book', totalChunks: 2 });
    const incomplete = new Error('the chunks were never stored');
    incomplete.code = BOOK_INCOMPLETE;
    readBookChunks.mockRejectedValueOnce(incomplete);

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(409);
  });

  // Ticket 17: with the Blob scan gone there is no second opinion, so an index that cannot be
  // read must not serve what a Book with no audio would serve.
  test('returns 502 when the Chunk index cannot be read at all', async () => {
    bookWithText(['你好。']);
    indexUnavailable();

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });

  test('returns a 502 when reading the Chunk index fails', async () => {
    bookWithText(['你好。']);
    chunkIndexClient.readIndex.mockRejectedValue(new Error('redis read failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
