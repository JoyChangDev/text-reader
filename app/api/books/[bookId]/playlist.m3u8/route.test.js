import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getCachedChunks } from '@/app/_lib/audioGenerationService';
import { getBook } from '@/app/_lib/libraryService';

vi.mock('@/app/_lib/libraryService', () => ({ getBook: vi.fn() }));
vi.mock('@/app/_lib/audioGenerationService', () => ({ getCachedChunks: vi.fn() }));

const { GET } = await import('./route');

function requestFor(bookId, query = '?voice=zh-TW-default') {
  return { url: `https://reader.example/api/books/${bookId}/playlist.m3u8${query}` };
}

function paramsFor(bookId) {
  return { params: Promise.resolve({ bookId }) };
}

const chunkAudio = (index, durationSeconds) => ({
  url: `https://blob.example/book-1/${index}/zh-TW-default.mp3`,
  boundaries: [],
  durationSeconds,
});

describe('GET /api/books/[bookId]/playlist.m3u8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A Listener who jumps past a stretch that was never narrated is served the Book from
  // where they landed, since the playlist can't reach across the gap they skipped (see
  // ticket 07).
  describe('?from', () => {
    test('serves the Book from the given Chunk', async () => {
      getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。', '二。', '三。'] });
      getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 5), chunkAudio(1, 4), chunkAudio(2, 3)]);

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
      getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。', '二。', '三。'] });
      getCachedChunks.mockResolvedValueOnce([undefined, chunkAudio(1, 4), chunkAudio(2, 3)]);

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=1'),
        paramsFor('book-1'),
      );
      const body = await response.text();

      expect(body).toContain('https://blob.example/book-1/1/zh-TW-default.mp3');
      expect(body).toContain('#EXT-X-ENDLIST');
    });

    test('rejects a start that names no Chunk in this Book with 400', async () => {
      getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。', '二。'] });
      getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 5), chunkAudio(1, 4)]);

      const response = await GET(
        requestFor('book-1', '?voice=zh-TW-default&from=7'),
        paramsFor('book-1'),
      );

      expect(response.status).toBe(400);
    });
  });

  test('serves the EVENT playlist for the Book and voice as an HLS media playlist', async () => {
    getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。', '二。'] });
    getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 5.5), chunkAudio(1, 4)]);

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(body).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(body).toContain('#EXTINF:5.500,');
    // Absolute blob URLs, fetched cross-origin by the media stack (verified in ticket 01).
    expect(body).toContain('https://blob.example/book-1/0/zh-TW-default.mp3');
    expect(body).toContain('#EXT-X-ENDLIST');
    expect(getCachedChunks).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-default',
      chunkCount: 2,
    });
  });

  // An EVENT playlist only works if every re-fetch sees the Book as it is now; a cached
  // copy would freeze playback at whatever the Book's length was on the first request.
  test('forbids caching so the media stack sees the playlist grow', async () => {
    getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。'] });
    getCachedChunks.mockResolvedValueOnce([undefined]);

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  test('keys the lookup by the requested voice', async () => {
    getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。'] });
    getCachedChunks.mockResolvedValueOnce([chunkAudio(0, 3)]);

    await GET(requestFor('book-1', '?voice=zh-TW-HsiaoYuNeural'), paramsFor('book-1'));

    expect(getCachedChunks).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'zh-TW-HsiaoYuNeural',
      chunkCount: 1,
    });
  });

  // The client points <audio> at this URL before any Chunk has finished generating.
  test('returns a valid, segment-free playlist for a Book with nothing generated yet', async () => {
    getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。', '二。'] });
    getCachedChunks.mockResolvedValueOnce([undefined, undefined]);

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
    expect(getCachedChunks).not.toHaveBeenCalled();
  });

  test('returns 404 when the book does not exist', async () => {
    getBook.mockResolvedValueOnce(null);

    const response = await GET(requestFor('missing'), paramsFor('missing'));

    expect(response.status).toBe(404);
  });

  test('returns a 502 when reading the Book fails', async () => {
    getBook.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });

  test('returns a 502 when reading the cached Chunks fails', async () => {
    getBook.mockResolvedValueOnce({ bookId: 'book-1', chunks: ['一。'] });
    getCachedChunks.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET(requestFor('book-1'), paramsFor('book-1'));

    expect(response.status).toBe(502);
  });
});
