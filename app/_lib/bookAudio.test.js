import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getCachedChunks } from './audioGenerationService';
import { getBookSummary, readBookChunks } from './libraryService';

vi.mock('./libraryService', () => ({ getBookSummary: vi.fn(), readBookChunks: vi.fn() }));
vi.mock('./audioGenerationService', () => ({ getCachedChunks: vi.fn() }));

const { readBookAudio } = await import('./bookAudio');

const SECOND = 10_000_000;
// Two Sentences of one word each, so a derived span is exactly its boundary.
const TEXT = '你好。世界。';
const boundaries = [
  { text: '你好', offset: 0, duration: SECOND },
  { text: '世界', offset: 2 * SECOND, duration: SECOND },
];
const spans = [
  { startSeconds: 0, endSeconds: 1 },
  { startSeconds: 2, endSeconds: 3 },
];

const BASE = 'https://abc.public.blob.vercel-storage.com/';
const chunks = [TEXT, TEXT, TEXT];
const summary = { bookId: 'book-1', title: 'A Book', totalChunks: 3 };
const request = { bookId: 'book-1', voice: 'voice-a' };

// The Blob shape: raw word boundaries, no spans.
const fromBlob = (index, durationSeconds = 5) => ({
  url: `${BASE}book-1/${index}/voice-a.mp3`,
  boundaries,
  durationSeconds,
});

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
  getCachedChunks.mockResolvedValue([undefined, undefined, undefined]);
});

describe('readBookAudio', () => {
  // The whole point of stage 2: the continuously polled path stops touching Blob at all.
  // On Hobby that is the difference between the app working and not - every Blob read is a
  // Simple Operation against a 10k monthly allowance.
  test('costs no Blob read at all when the index answers', async () => {
    const chunkIndexClient = indexClient({ durations: { 0: '12.5', 1: '11' } });

    const result = await readBookAudio(request, { chunkIndexClient });

    expect(getCachedChunks).not.toHaveBeenCalled();
    expect(result.chunkAudio[0]).toEqual({
      url: `${BASE}book-1/0/voice-a.mp3`,
      durationSeconds: 12.5,
    });
    expect(result.chunkAudio[1].durationSeconds).toBe(11);
    expect(result.chunkAudio[2]).toBeUndefined();
  });

  // The index is a cache, so it has to be able to not answer without anything breaking -
  // an unwritten one, an evicted one and an unreachable one are all the same case.
  test('falls back to the Blob scan when the index misses', async () => {
    getCachedChunks.mockResolvedValue([fromBlob(0), undefined, undefined]);
    const chunkIndexClient = indexClient();

    const result = await readBookAudio(request, { chunkIndexClient });

    expect(getCachedChunks).toHaveBeenCalledWith({
      bookId: 'book-1',
      voice: 'voice-a',
      chunkCount: 3,
      from: 0,
    });
    expect(result.chunkAudio[0]).toMatchObject({ durationSeconds: 5 });
  });

  test('threads `from` to whichever source answers', async () => {
    const chunkIndexClient = indexClient({ durations: { 0: '12', 2: '11' } });

    const result = await readBookAudio({ ...request, from: '2' }, { chunkIndexClient });

    // Scanned from 2, so the gap at 1 that the Listener jumped over does not truncate it.
    expect(result.from).toBe(2);
    expect(result.chunkAudio[2]).toBeDefined();

    await readBookAudio({ ...request, from: '2' }, { chunkIndexClient: indexClient() });
    expect(getCachedChunks).toHaveBeenCalledWith(expect.objectContaining({ from: 2 }));
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
    // with no highlighting and no way to notice. Durations and cues are written together,
    // so the two disagreeing means the index is damaged, not that the Chunk is silent.
    test('send the whole lookup back to Blob when a placed Chunk has none', async () => {
      getCachedChunks.mockResolvedValue([fromBlob(0), fromBlob(1), undefined]);
      const chunkIndexClient = indexClient({
        durations: { 0: '12.5', 1: '11' },
        cues: { 0: spans },
      });

      const result = await readBookAudio({ ...request, needsCues: true }, { chunkIndexClient });

      expect(getCachedChunks).toHaveBeenCalled();
      expect(result.chunkAudio[1].spans).toEqual(spans);
    });

    // bookManifest only ever sees spans, so the Blob path has to derive what the index
    // path stored at generation time - otherwise a fallback silently drops every cue.
    test('are derived from stored boundaries on the Blob path', async () => {
      getCachedChunks.mockResolvedValue([fromBlob(0), undefined, undefined]);

      const result = await readBookAudio(
        { ...request, needsCues: true },
        { chunkIndexClient: indexClient() },
      );

      expect(result.chunkAudio[0].spans).toEqual(spans);
    });

    test('are not derived on the Blob path for the playlist, which would not read them', async () => {
      getCachedChunks.mockResolvedValue([fromBlob(0), undefined, undefined]);

      const result = await readBookAudio(request, { chunkIndexClient: indexClient() });

      expect(result.chunkAudio[0]).not.toHaveProperty('spans');
    });
  });

  describe('what it refuses to look up', () => {
    test('returns null for an unknown Book without reading either source', async () => {
      getBookSummary.mockResolvedValue(null);
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' } });

      expect(await readBookAudio(request, { chunkIndexClient })).toBeNull();
      expect(chunkIndexClient.readIndex).not.toHaveBeenCalled();
      expect(getCachedChunks).not.toHaveBeenCalled();
    });

    test('returns an error for a `from` that names no Chunk, before reading anything', async () => {
      const chunkIndexClient = indexClient({ durations: { 0: '12.5' } });

      const result = await readBookAudio({ ...request, from: '99' }, { chunkIndexClient });

      expect(result.error).toBeTruthy();
      expect(chunkIndexClient.readIndex).not.toHaveBeenCalled();
      expect(getCachedChunks).not.toHaveBeenCalled();
      expect(readBookChunks).not.toHaveBeenCalled();
    });
  });
});
