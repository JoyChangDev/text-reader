import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getBookSummary, readBookChunks } from './libraryService';

vi.mock('./libraryService', () => ({ getBookSummary: vi.fn(), readBookChunks: vi.fn() }));

const { readBookAudio } = await import('./bookAudio');

// Two Sentences of one word each.
const TEXT = '你好。世界。';
const spans = [
  { startSeconds: 0, endSeconds: 1 },
  { startSeconds: 2, endSeconds: 3 },
];

const BASE = 'https://abc.public.blob.vercel-storage.com/';
const chunks = [TEXT, TEXT, TEXT];
const summary = { bookId: 'book-1', title: 'A Book', totalChunks: 3 };
const request = { bookId: 'book-1', voice: 'voice-a' };

function indexClient({ durations, base = BASE, cues } = {}) {
  return {
    readIndex: vi.fn().mockResolvedValue(durations ? { base, durations } : undefined),
    readCues: vi.fn(async (unused, chunkIndexes) => chunkIndexes.map((index) => cues?.[index])),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getBookSummary.mockResolvedValue(summary);
  readBookChunks.mockResolvedValue(chunks);
});

describe('readBookAudio', () => {
  // The whole point of stage 2: the continuously polled path stops touching Blob at all.
  // On Hobby that is the difference between the app working and not - every Blob read is a
  // Simple Operation against a 10k monthly allowance.
  test('costs no Blob read at all when the index answers', async () => {
    const chunkIndexClient = indexClient({ durations: { 0: '12.5', 1: '11' } });

    const result = await readBookAudio(request, { chunkIndexClient });

    expect(result.chunkAudio[0]).toEqual({
      url: `${BASE}book-1/0/voice-a.mp3`,
      durationSeconds: 12.5,
    });
    expect(result.chunkAudio[1].durationSeconds).toBe(11);
    expect(result.chunkAudio[2]).toBeUndefined();
  });

  // Ticket 17 removed the Blob scan behind the index, so a read that cannot answer has
  // nowhere to fall back to and must not be mistaken for a Book with no audio. The routes
  // turn this into a 502; an empty Book gets an empty playlist, which is a different thing.
  test('reports the lookup unavailable when the index cannot be read', async () => {
    const result = await readBookAudio(request, { chunkIndexClient: indexClient() });

    expect(result).toEqual({ unavailable: true });
  });

  // The other half of that distinction: Redis answered, and the answer is that this Book has
  // never been narrated. That is an ordinary state - every Book is in it once - and it has to
  // read as an empty run rather than as a failure.
  test('is an empty run, not unavailable, for a Book with nothing narrated', async () => {
    const result = await readBookAudio(request, {
      chunkIndexClient: indexClient({ durations: {} }),
    });

    expect(result.unavailable).toBeUndefined();
    expect(result.chunkAudio).toHaveLength(3);
    expect(result.chunkAudio.every((entry) => entry === undefined)).toBe(true);
  });

  test('threads `from` to the index read', async () => {
    const chunkIndexClient = indexClient({ durations: { 0: '12', 2: '11' } });

    const result = await readBookAudio({ ...request, from: '2' }, { chunkIndexClient });

    expect(result.from).toBe(2);
    expect(result.chunkAudio[2]).toBeDefined();
  });

  // The Book's text is the largest thing either route can read - 1.6 MB on a 4,962-Chunk
  // Book, measured against the deployed app - and the playlist is re-fetched every
  // ~42 seconds for as long as a Listener is listening. See ticket 12.
  describe('the Book’s text', () => {
    test('is not read for the playlist, which needs only how long the Book is', async () => {
      const chunkIndexClient = indexClient({ durations: { 0: '12.5', 1: '11' } });

      const result = await readBookAudio({ ...request, from: '1' }, { chunkIndexClient });

      expect(readBookChunks).not.toHaveBeenCalled();
      // The count still bounds the run, it just came from the index entry instead.
      expect(result.chunkAudio).toHaveLength(3);
    });

    // bookManifest counts Sentence ordinals from the Chunk text, and the Blob fallback
    // derives spans from it. Neither has anywhere cheaper to get it.
    test('is read for the manifest, which counts Sentence ordinals from it', async () => {
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' }, cues: { 0: spans } });

      const result = await readBookAudio({ ...request, needsCues: true }, { chunkIndexClient });

      expect(readBookChunks).toHaveBeenCalledWith('book-1');
      expect(result.chunks).toEqual(chunks);
    });

    // A Book indexed before addBook recorded totalChunks has no cheap count. Reading it as
    // `undefined` would build a one-element run and serve a fully narrated Book as a stump
    // of a playlist, so it pays the read it always paid instead.
    test('is read anyway when the index entry does not say how long the Book is', async () => {
      getBookSummary.mockResolvedValue({ bookId: 'book-1', title: 'A Book' });
      const chunkIndexClient = indexClient({ durations: { 0: '12.5', 1: '11' } });

      const result = await readBookAudio(request, { chunkIndexClient });

      expect(readBookChunks).toHaveBeenCalledWith('book-1');
      expect(result.chunkAudio[1].durationSeconds).toBe(11);
    });
  });

  describe('cues', () => {
    // The cues hash is ~130-450 KB on a 2,000-Chunk Book against ~36 KB for durations.
    // Reading it on the polled path would undo most of what this ticket is for.
    test('are not read for the playlist, which needs durations alone', async () => {
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' } });

      await readBookAudio(request, { chunkIndexClient });

      expect(chunkIndexClient.readCues).not.toHaveBeenCalled();
    });

    test('are read for the manifest, for placed Chunks only', async () => {
      const chunkIndexClient = indexClient({
        durations: { 0: '12.5', 1: '11' },
        cues: { 0: spans, 1: spans },
      });

      const result = await readBookAudio({ ...request, needsCues: true }, { chunkIndexClient });

      // Chunk 2 is past the gap, so it is not placed and its cues are never asked for.
      expect(chunkIndexClient.readCues).toHaveBeenCalledWith(
        { bookId: 'book-1', voice: 'voice-a' },
        [0, 1],
      );
      expect(result.chunkAudio[0]).toEqual({
        url: `${BASE}book-1/0/voice-a.mp3`,
        durationSeconds: 12.5,
        spans,
      });
    });

    // A placed Chunk with no cues would otherwise render as a stretch of Book that plays
    // with no highlighting and no way to notice. Durations and cues are written together, so
    // the two disagreeing means the index is damaged. It used to send the lookup back to
    // Blob, which carried the raw boundaries the spans could be rebuilt from; nothing carries
    // them now, so damage is reported rather than papered over.
    test('report the lookup unavailable when a placed Chunk has none', async () => {
      const chunkIndexClient = indexClient({
        durations: { 0: '12.5', 1: '11' },
        cues: { 0: spans },
      });

      const result = await readBookAudio({ ...request, needsCues: true }, { chunkIndexClient });

      expect(result).toEqual({ unavailable: true });
    });
  });

  describe('what it refuses to look up', () => {
    test('returns null for an unknown Book without reading either source', async () => {
      getBookSummary.mockResolvedValue(null);
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' } });

      expect(await readBookAudio(request, { chunkIndexClient })).toBeNull();
      expect(chunkIndexClient.readIndex).not.toHaveBeenCalled();
    });

    test('returns an error for a `from` that names no Chunk, before reading anything', async () => {
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' } });

      const result = await readBookAudio({ ...request, from: '99' }, { chunkIndexClient });

      expect(result.error).toBeTruthy();
      expect(chunkIndexClient.readIndex).not.toHaveBeenCalled();
      expect(readBookChunks).not.toHaveBeenCalled();
    });
  });
});
