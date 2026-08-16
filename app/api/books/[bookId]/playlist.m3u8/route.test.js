import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getBookSummary, readBookChunks } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({
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

function requestFor(bookId, query = '?voice=zh-TW-default') {
  return { url: `https://reader.example/api/books/${bookId}/playlist.m3u8${query}` };
}

function paramsFor(bookId) {
  return { params: Promise.resolve({ bookId }) };
}

// The Chunk index as Redis holds it: a durations hash keyed by Chunk index, and the segment
// origin the URLs are derived from. Since ticket 17 this is the route's only source, so the
// fixture is the real shape rather than a convenient stand-in - a fake that reports more than
// the routes do is what hid ticket 17 for a day.
const SEGMENT_ORIGIN = 'https://blob.example/';

function indexed(durations) {
  chunkIndexClient.readIndex.mockResolvedValue({ base: SEGMENT_ORIGIN, durations });
  chunkIndexClient.readCues.mockImplementation(async (unused, indexes) => indexes.map(() => []));
}

// No index at all: since ticket 17 that is an outage rather than an empty Book.
function indexUnavailable() {
  chunkIndexClient.readIndex.mockResolvedValue(undefined);
}

// How long the Book is, and nothing else. The playlist reads its length off the Library
// index entry and never touches the Chunk text (see ticket 12), so a Book here is a count.
function bookOfLength(totalChunks) {
  getBookSummary.mockResolvedValueOnce({ bookId: 'book-1', title: 'First Book', totalChunks });
}

describe('GET /api/books/[bookId]/playlist.m3u8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A Listener who jumps past a stretch that was never narrated is served the Book from
  // where they landed, since the playlist can't reach across the gap they skipped (see
  // ticket 07).
  describe('?from', () => {
    test('serves the Book from the given Chunk', async () => {
      bookOfLength(3);
      indexed({ 0: 5, 1: 4, 2: 3 });

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=1'),
        paramsFor('book-1'),
      );
      const body = await response.text();

      expect(body).not.toContain('https://blob.example/book-1/0/zh-TW-default.mp3');
      expect(body).toContain('https://blob.example/book-1/1/zh-TW-default.mp3');
      expect(body).toContain('https://blob.example/book-1/2/zh-TW-default.mp3');
    });

    // The whole point: the Chunks the Listener skipped are still ungenerated, and must
    // not truncate the stream they are now listening to.
    test('is unaffected by a gap before the given Chunk', async () => {
      bookOfLength(3);
      indexed({ 1: 4, 2: 3 });

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=1'),
        paramsFor('book-1'),
      );
      const body = await response.text();

      expect(body).toContain('https://blob.example/book-1/1/zh-TW-default.mp3');
      expect(body).toContain('#EXT-X-ENDLIST');
    });

    // No index mock: the Chunk audio is never read, which is the point - an unusable start
    // is rejected before anything touches the store.
    test('rejects a start that names no Chunk in this Book with 400', async () => {
      bookOfLength(2);

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=7'),
        paramsFor('book-1'),
      );

      expect(response.status).toBe(400);
    });
  });

  test('serves the EVENT playlist for the Book and voice as an HLS media playlist', async () => {
    bookOfLength(2);
    indexed({ 0: 5.5, 1: 4 });

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(body).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(body).toContain('#EXTINF:5.500,');
    // Absolute blob URLs, fetched cross-origin by the media stack (verified in ticket 01).
    expect(body).toContain('https://blob.example/book-1/0/zh-TW-default.mp3');
    expect(body).toContain('#EXT-X-ENDLIST');
    expect(chunkIndexClient.readIndex).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-default',
    });
  });

  // This route is polled for as long as a Listener is listening - every ~42 seconds on the
  // device. It was reading the Book's whole text on each of those to take `.length` from
  // it: 1.6 MB and ~0.6s per poll on a 4,962-Chunk Book, measured against the deployed app
  // (see ticket 12).
  test('never reads the Book’s text, however many polls it serves', async () => {
    bookOfLength(2);
    indexed({ 0: 5.5, 1: 4 });

    await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(readBookChunks).not.toHaveBeenCalled();
  });

  // An EVENT playlist only works if every re-fetch sees the Book as it is now; a cached
  // copy would freeze playback at whatever the Book's length was on the first request.
  test('forbids caching so the media stack sees the playlist grow', async () => {
    bookOfLength(1);
    indexed({});

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  test('keys the lookup by the requested voice', async () => {
    bookOfLength(1);
    indexed({ 0: 3 });

    await GET(requestFor('book-1', '?voice=zh-TW-HsiaoYuNeural'), paramsFor('book-1'));

    expect(chunkIndexClient.readIndex).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-HsiaoYuNeural',
    });
  });

  // The client points <audio> at this URL before any Chunk has finished generating.
  test('returns a valid, segment-free playlist for a Book with nothing generated yet', async () => {
    bookOfLength(2);
    indexed({});

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('#EXTM3U');
    expect(body).not.toContain('#EXTINF');
    expect(body).not.toContain('#EXT-X-ENDLIST');
  });

  test('rejects a request with no voice with 400', async () => {
    const response = await GET(requestFor('book-1', ''), paramsFor('book-1'));

    expect(response.status).toBe(400);
  });

  // Ticket 17: with the Blob scan gone there is no second opinion, so an index that cannot be
  // read must not serve what a Book with no audio would serve. An empty playlist is truthful
  // for an unnarrated Book and a lie for a store that is down.
  test('returns 502 when the Chunk index cannot be read at all', async () => {
    bookOfLength(2);
    indexUnavailable();

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
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

  test('returns a 502 when reading the Chunk index fails', async () => {
    bookOfLength(1);
    chunkIndexClient.readIndex.mockRejectedValue(new Error('redis read failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
