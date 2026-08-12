import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getCachedChunks } from '@/app/_lib/audioGenerationService';
import { getBookSummary, readBookChunks } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
  getBookSummary: vi.fn(),
  readBookChunks: vi.fn(),
}));
vi.mock('@/app/_lib/audioGenerationService', () => ({ getCachedChunks: vi.fn() }));

const { GET } = await import('./route');

const SECOND = 10_000_000;

function requestFor(bookId, query = '?voice=zh-TW-default') {
  return { url: `https://reader.example/api/books/${bookId}/manifest${query}` };
}

function paramsFor(bookId) {
  return { params: Promise.resolve({ bookId }) };
}

// One word per sentence, so each derived span is exactly one boundary.
const chunkAudio = (index, durationSeconds) => ({
  url: `https://blob.example/book-1/${index}/zh-TW-default.mp3`,
  boundaries: [
    { text: '你好', offset: 0, duration: SECOND },
    { text: '世界', offset: 2 * SECOND, duration: SECOND },
  ],
  durationSeconds,
});

// Unlike the playlist, the manifest genuinely needs the Chunk text: bookManifest counts
// Sentence ordinals from it, and the Blob fallback derives spans from it (see ticket 12).
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
    getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 7.5), chunkAudio(1, 4)]);

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
    expect(getCachedChunks).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-default',
      chunkCount: 2,
      from: 0,
    });
  });

  test('keys the lookup by the requested voice', async () => {
    bookWithText(['你好。']);
    getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 3)]);

    await GET(requestFor('book-1', '?voice=zh-TW-HsiaoYuNeural'), paramsFor('book-1'));

    expect(getCachedChunks).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-HsiaoYuNeural',
      chunkCount: 1,
      from: 0,
    });
  });

  // Cues are added as the Book generates, so a stale copy would leave the client
  // permanently short of the Sentences it needs.
  test('forbids caching so a growing Book keeps yielding new cues', async () => {
    bookWithText(['你好。']);
    getCachedChunks.mockResolvedValueOnce([undefined]);

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  test('returns an empty manifest, not an error, for a Book with nothing generated yet', async () => {
    bookWithText(['你好。', '世界。']);
    getCachedChunks.mockResolvedValueOnce([undefined, undefined]);

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
      getCachedChunks.mockResolvedValueOnce([
        chunkAudio(0, 7.5),
        chunkAudio(1, 4),
        chunkAudio(2, 6),
      ]);

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

    // No getCachedChunks mock: the Chunk audio is never read, which is the point - an
    // unusable start is rejected before anything touches the store.
    test('rejects a start that names no Chunk in this Book with 400', async () => {
      bookWithText(['你好。']);

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=4'),
        paramsFor('book-1'),
      );

      expect(response.status).toBe(400);
      expect(getCachedChunks).not.toHaveBeenCalled();
    });
  });

  test('rejects a request with no voice with 400', async () => {
    const response = await GET(requestFor('book-1', ''), paramsFor('book-1'));

    expect(response.status).toBe(400);
    expect(getCachedChunks).not.toHaveBeenCalled();
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

  test('returns a 502 when reading the cached Chunks fails', async () => {
    bookWithText(['你好。']);
    getCachedChunks.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
