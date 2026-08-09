import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeStorageClient, fakeTtsClient } = vi.hoisted(() => ({
  fakeStorageClient: { get: vi.fn(), put: vi.fn(), getAudioBytes: vi.fn(), putJson: vi.fn() },
  fakeTtsClient: { synthesize: vi.fn() },
}));

vi.mock('./blobStorageClient', () => ({
  createBlobStorageClient: () => fakeStorageClient,
}));
vi.mock('./edgeTtsClient', () => ({
  createEdgeTtsClient: () => fakeTtsClient,
}));

import {
  generateAudioForChunk,
  getOrGenerateAudio,
  readCachedChunks,
} from './audioGenerationService';
// Real frames, so the duration these paths measure is non-zero the way production's is;
// mp3Frames.test.js covers the parsing itself.
import { buildMp3Frames, MP3_FRAME_DURATION_SECONDS } from './mp3Frames.fixture';

describe('getOrGenerateAudio', () => {
  let storageClient;
  let ttsClient;

  beforeEach(() => {
    storageClient = { get: vi.fn(), put: vi.fn(), getAudioBytes: vi.fn(), putJson: vi.fn() };
    ttsClient = { synthesize: vi.fn() };
  });

  test('returns the cached result without calling ttsClient on a cache hit', async () => {
    // Arrange: fake storageClient already has this chunk cached, with durationSeconds
    const cachedResult = {
      url: 'https://blob.example/cached.mp3',
      boundaries: [],
      durationSeconds: 12.5,
    };
    storageClient.get.mockResolvedValue(cachedResult);

    // Act
    const result = await getOrGenerateAudio(
      { storageClient, ttsClient },
      { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
    );

    // Assert
    expect(result).toEqual(cachedResult);
    expect(ttsClient.synthesize).not.toHaveBeenCalled();
    expect(storageClient.getAudioBytes).not.toHaveBeenCalled();
  });

  test('lazily re-measures and repairs a cache hit from before durationSeconds existed', async () => {
    // Arrange: a chunk cached before ticket 02, with no durationSeconds field
    const legacyCached = { url: 'https://blob.example/cached.mp3', boundaries: [] };
    storageClient.get.mockResolvedValue(legacyCached);
    storageClient.getAudioBytes.mockResolvedValue(buildMp3Frames(20));

    // Act
    const result = await getOrGenerateAudio(
      { storageClient, ttsClient },
      { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
    );

    // Assert: the sum of 20 frame durations, which accumulates float error against 20 * one
    expect(ttsClient.synthesize).not.toHaveBeenCalled();
    expect(storageClient.getAudioBytes).toHaveBeenCalledWith('book-1/0/zh-TW-default');
    expect(result).toEqual({
      ...legacyCached,
      durationSeconds: expect.closeTo(20 * MP3_FRAME_DURATION_SECONDS, 10),
    });
    expect(storageClient.putJson).toHaveBeenCalledWith('book-1/0/zh-TW-default', result);
  });

  test('regenerates instead of persisting a zero when the cached audio cannot be measured', async () => {
    // Arrange: legacy metadata whose audio blob is gone, so re-measurement has nothing to read
    storageClient.get.mockResolvedValue({ url: 'https://blob.example/cached.mp3', boundaries: [] });
    storageClient.getAudioBytes.mockResolvedValue(undefined);
    const synthesized = { audio: new Blob([buildMp3Frames(20)]), boundaries: [] };
    const persisted = { url: 'https://blob.example/regenerated.mp3', boundaries: [] };
    ttsClient.synthesize.mockResolvedValue(synthesized);
    storageClient.put.mockResolvedValue(persisted);

    // Act
    const result = await getOrGenerateAudio(
      { storageClient, ttsClient },
      { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
    );

    // Assert: a zero would be permanent once written, so nothing is persisted from it
    expect(storageClient.putJson).not.toHaveBeenCalled();
    expect(result).toEqual(persisted);
    expect(storageClient.put).toHaveBeenCalledWith('book-1/0/zh-TW-default', {
      ...synthesized,
      durationSeconds: expect.closeTo(20 * MP3_FRAME_DURATION_SECONDS, 10),
    });
  });

  test('calls ttsClient and persists the result, with measured duration, on a cache miss', async () => {
    // Arrange
    const synthesized = {
      audio: new Blob(['fake-audio']),
      boundaries: [{ text: '你好', offset: 0, duration: 1000 }],
    };
    const persisted = {
      url: 'https://blob.example/generated.mp3',
      boundaries: synthesized.boundaries,
      durationSeconds: 0,
    };
    storageClient.get.mockResolvedValue(undefined);
    storageClient.put.mockResolvedValue(persisted);
    ttsClient.synthesize.mockResolvedValue(synthesized);

    // Act
    const result = await getOrGenerateAudio(
      { storageClient, ttsClient },
      { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
    );

    // Assert
    expect(result).toEqual(persisted);
    expect(ttsClient.synthesize).toHaveBeenCalledWith('你好。', 'zh-TW-default');
    // 'fake-audio' has no valid MP3 frames, so the measured duration is 0 — the point
    // being tested is that it's computed and threaded through, not the specific value.
    expect(storageClient.put).toHaveBeenCalledWith('book-1/0/zh-TW-default', {
      ...synthesized,
      durationSeconds: 0,
    });
  });

  test('propagates the error and does not persist anything when generation fails', async () => {
    // Arrange
    storageClient.get.mockResolvedValue(undefined);
    ttsClient.synthesize.mockRejectedValue(new Error('edge-tts request failed'));

    // Act / Assert
    await expect(
      getOrGenerateAudio(
        { storageClient, ttsClient },
        { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
      ),
    ).rejects.toThrow('edge-tts request failed');
    expect(storageClient.put).not.toHaveBeenCalled();
  });

  test('propagates the error when persisting the generated audio fails', async () => {
    // Arrange
    const synthesized = {
      audio: new Blob(['fake-audio']),
      boundaries: [{ text: '你好', offset: 0, duration: 1000 }],
    };
    storageClient.get.mockResolvedValue(undefined);
    storageClient.put.mockRejectedValue(new Error('blob upload failed'));
    ttsClient.synthesize.mockResolvedValue(synthesized);

    // Act / Assert
    await expect(
      getOrGenerateAudio(
        { storageClient, ttsClient },
        { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
      ),
    ).rejects.toThrow('blob upload failed');
  });
});

// The index is what takes the polled playlist path to zero Blob reads, and generation is
// the only thing that writes it - see ticket 08's stage 2.
describe('getOrGenerateAudio, indexing what it produced', () => {
  const SECOND = 10_000_000;
  // Two sentences of one word each, so the derived spans are exactly these boundaries.
  const text = '你好。世界。';
  const boundaries = [
    { text: '你好', offset: 0, duration: SECOND },
    { text: '世界', offset: 2 * SECOND, duration: SECOND },
  ];
  const chunk = { bookId: 'book-1', chunkIndex: 7, voice: 'zh-TW-default', text };

  let storageClient;
  let ttsClient;
  let chunkIndexClient;

  beforeEach(() => {
    storageClient = { get: vi.fn(), put: vi.fn(), getAudioBytes: vi.fn(), putJson: vi.fn() };
    ttsClient = { synthesize: vi.fn() };
    chunkIndexClient = { writeChunk: vi.fn().mockResolvedValue(undefined) };
  });

  // The store origin is recovered from the URL the Blob store actually returned, rather
  // than parsed out of BLOB_READ_WRITE_TOKEN or configured as a second env var.
  test('indexes a newly generated Chunk with its duration, spans and store origin', async () => {
    storageClient.get.mockResolvedValue(undefined);
    ttsClient.synthesize.mockResolvedValue({ audio: new Blob([buildMp3Frames(20)]), boundaries });
    storageClient.put.mockImplementation(async (key, metadata) => ({
      url: `https://abc.public.blob.vercel-storage.com/${key}.mp3`,
      ...metadata,
    }));

    await getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk);

    expect(chunkIndexClient.writeChunk).toHaveBeenCalledWith(
      { bookId: 'book-1', chunkIndex: 7, voice: 'zh-TW-default' },
      {
        durationSeconds: expect.closeTo(20 * MP3_FRAME_DURATION_SECONDS, 10),
        spans: [
          { startSeconds: 0, endSeconds: 1 },
          { startSeconds: 2, endSeconds: 3 },
        ],
        base: 'https://abc.public.blob.vercel-storage.com/',
      },
    );
  });

  // Deriving here is what takes deriveSentenceSpans off the manifest's request path, which
  // is most of the 4.7s that route spends in application code on a 2,000-Chunk Book.
  test('derives Sentence spans once at generation time rather than storing raw boundaries', async () => {
    storageClient.get.mockResolvedValue(undefined);
    ttsClient.synthesize.mockResolvedValue({ audio: new Blob([buildMp3Frames(20)]), boundaries });
    storageClient.put.mockResolvedValue({
      url: 'https://abc.public.blob.vercel-storage.com/book-1/7/zh-TW-default.mp3',
      boundaries,
      durationSeconds: 5,
    });

    await getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk);

    const [, indexed] = chunkIndexClient.writeChunk.mock.calls[0];
    expect(indexed.spans).toEqual([
      { startSeconds: 0, endSeconds: 1 },
      { startSeconds: 2, endSeconds: 3 },
    ]);
    expect(indexed).not.toHaveProperty('boundaries');
  });

  // Redis is a cache, so nothing ever rewrites the index on its own. A Book generated
  // before the index existed - or one whose index was evicted - is only ever re-indexed by
  // the Listener reading through it again, which is what makes "degrades to a rebuild" true.
  test('indexes a Chunk that came back from the cache, so an evicted index rebuilds', async () => {
    storageClient.get.mockResolvedValue({
      url: 'https://abc.public.blob.vercel-storage.com/book-1/7/zh-TW-default.mp3',
      boundaries,
      durationSeconds: 12.5,
    });

    await getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk);

    expect(ttsClient.synthesize).not.toHaveBeenCalled();
    expect(chunkIndexClient.writeChunk).toHaveBeenCalledWith(
      { bookId: 'book-1', chunkIndex: 7, voice: 'zh-TW-default' },
      expect.objectContaining({
        durationSeconds: 12.5,
        base: 'https://abc.public.blob.vercel-storage.com/',
      }),
    );
  });

  test('indexes a repaired Chunk under its re-measured duration, not its missing one', async () => {
    storageClient.get.mockResolvedValue({
      url: 'https://abc.public.blob.vercel-storage.com/book-1/7/zh-TW-default.mp3',
      boundaries,
    });
    storageClient.getAudioBytes.mockResolvedValue(buildMp3Frames(20));

    await getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk);

    expect(chunkIndexClient.writeChunk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        durationSeconds: expect.closeTo(20 * MP3_FRAME_DURATION_SECONDS, 10),
      }),
    );
  });

  test('indexes nothing when generation failed', async () => {
    storageClient.get.mockResolvedValue(undefined);
    ttsClient.synthesize.mockRejectedValue(new Error('edge-tts request failed'));

    await expect(
      getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk),
    ).rejects.toThrow('edge-tts request failed');
    expect(chunkIndexClient.writeChunk).not.toHaveBeenCalled();
  });

  // The client generates a Chunk and then the playlist is polled for it. If the write were
  // left in flight, that poll would read an index that still stops one Chunk short - and
  // because a short run is a hit rather than a miss, nothing would fall back to Blob to
  // correct it. The Chunk would simply be missing from the playlist until the next poll.
  test('waits for the index write, so the poll that follows cannot miss the Chunk', async () => {
    const order = [];
    storageClient.get.mockResolvedValue({
      url: 'https://abc.public.blob.vercel-storage.com/book-1/7/zh-TW-default.mp3',
      boundaries,
      durationSeconds: 12.5,
    });
    chunkIndexClient.writeChunk.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push('indexed');
    });

    await getOrGenerateAudio({ storageClient, ttsClient, chunkIndexClient }, chunk);
    order.push('returned');

    expect(order).toEqual(['indexed', 'returned']);
  });

  test('still returns the audio when the caller supplied no index client at all', async () => {
    const cached = { url: 'https://abc.example/x.mp3', boundaries, durationSeconds: 12.5 };
    storageClient.get.mockResolvedValue(cached);

    await expect(getOrGenerateAudio({ storageClient, ttsClient }, chunk)).resolves.toEqual(cached);
  });
});

describe('readCachedChunks', () => {
  test('returns one entry per Chunk index, undefined where the Chunk is not cached', async () => {
    const cached = { url: 'https://blob.example/0.mp3', boundaries: [], durationSeconds: 5 };
    const storageClient = {
      get: vi.fn(async (key) => (key === 'book-1/0/zh-TW-default' ? cached : undefined)),
    };

    const chunks = await readCachedChunks(
      { storageClient },
      { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 3 },
    );

    expect(chunks).toEqual([cached, undefined, undefined]);
    expect(storageClient.get.mock.calls.map(([key]) => key)).toEqual([
      'book-1/0/zh-TW-default',
      'book-1/1/zh-TW-default',
      'book-1/2/zh-TW-default',
    ]);
  });

  // The playlist and manifest routes read; only /api/audio-chunks generates. A missing or
  // unmeasurable Chunk is reported as missing rather than repaired in place here.
  test('writes nothing back for a Chunk it finds missing', async () => {
    const storageClient = {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn(),
      putJson: vi.fn(),
    };

    await readCachedChunks(
      { storageClient },
      { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 2 },
    );

    expect(storageClient.put).not.toHaveBeenCalled();
    expect(storageClient.putJson).not.toHaveBeenCalled();
  });

  test('reads nothing for a Book with no Chunks', async () => {
    const storageClient = { get: vi.fn() };

    const chunks = await readCachedChunks(
      { storageClient },
      { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 0 },
    );

    expect(chunks).toEqual([]);
    expect(storageClient.get).not.toHaveBeenCalled();
  });

  // Each of these reads is an unauthenticated fetch of a public Blob URL, and reading one
  // per Chunk of a whole Book at once is what trips the store's rate limiting (see ticket
  // 08). Everything past the first gap is read for nothing anyway: the playlist truncates
  // there and the manifest follows it.
  describe('bounding the read to what the timeline can use', () => {
    const cached = (index) => ({
      url: `https://blob.example/${index}.mp3`,
      boundaries: [],
      durationSeconds: 5,
    });

    function storageWith(generatedIndexes) {
      return {
        get: vi.fn(async (key) => {
          const index = Number(key.split('/')[1]);
          return generatedIndexes.includes(index) ? cached(index) : undefined;
        }),
      };
    }

    function readIndexes(storageClient) {
      return storageClient.get.mock.calls.map(([key]) => Number(key.split('/')[1]));
    }

    test('stops at the first gap instead of reading the rest of the Book', async () => {
      const storageClient = storageWith([0, 1, 2]);

      const chunks = await readCachedChunks(
        { storageClient },
        { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 500 },
      );

      expect(chunks).toHaveLength(500);
      expect(chunks.slice(0, 3)).toEqual([cached(0), cached(1), cached(2)]);
      expect(chunks[3]).toBeUndefined();
      expect(Math.max(...readIndexes(storageClient))).toBeLessThan(50);
    });

    // A Chunk past the gap reads as ungenerated because this never looked. That is what
    // the playlist already concluded about it, and the client re-points rather than
    // waiting for a timeline that can't reach it (ticket 07).
    test('reports a Chunk beyond the gap as absent even if it is stored', async () => {
      const storageClient = storageWith([0, 1, 400]);

      const chunks = await readCachedChunks(
        { storageClient },
        { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 500 },
      );

      expect(chunks[400]).toBeUndefined();
      expect(readIndexes(storageClient)).not.toContain(400);
    });

    // The Listener seeking past a gap re-points the playlist to start there, so the scan
    // has to start there too - otherwise it stops at a gap the Listener already jumped
    // over and the re-pointed playlist comes back empty.
    test('starts at the given Chunk, ignoring a gap before it', async () => {
      const storageClient = storageWith([15, 16, 17]);

      const chunks = await readCachedChunks(
        { storageClient },
        { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 500, from: 15 },
      );

      expect(chunks.slice(15, 18)).toEqual([cached(15), cached(16), cached(17)]);
      expect(chunks[0]).toBeUndefined();
      expect(readIndexes(storageClient)).not.toContain(0);
      expect(readIndexes(storageClient)).toContain(15);
    });

    test('reads a contiguous run in far fewer round trips than one per Chunk', async () => {
      const storageClient = storageWith(Array.from({ length: 11 }, (unused, i) => i));

      await readCachedChunks(
        { storageClient },
        { bookId: 'book-1', voice: 'zh-TW-default', chunkCount: 1983 },
      );

      // The whole Book was 1,983 reads before this; the generated run is 11 Chunks long.
      expect(storageClient.get.mock.calls.length).toBeLessThan(50);
    });
  });
});

describe('generateAudioForChunk', () => {
  beforeEach(() => {
    fakeStorageClient.get.mockReset();
    fakeStorageClient.put.mockReset();
    fakeStorageClient.getAudioBytes.mockReset();
    fakeStorageClient.putJson.mockReset();
    fakeTtsClient.synthesize.mockReset();
  });

  test('threads the caller-supplied voice through to the cache key and ttsClient', async () => {
    fakeStorageClient.get.mockResolvedValue(undefined);
    const synthesized = { audio: new Blob(['fake-audio']), boundaries: [] };
    const persisted = { url: 'https://blob.example/generated.mp3', boundaries: [] };
    fakeTtsClient.synthesize.mockResolvedValue(synthesized);
    fakeStorageClient.put.mockResolvedValue(persisted);

    const result = await generateAudioForChunk({
      bookId: 'book-1',
      chunkIndex: 0,
      text: '你好。',
      voice: 'zh-TW-YunJheNeural',
    });

    expect(result).toEqual(persisted);
    expect(fakeStorageClient.get).toHaveBeenCalledWith('book-1/0/zh-TW-YunJheNeural');
    expect(fakeTtsClient.synthesize).toHaveBeenCalledWith('你好。', 'zh-TW-YunJheNeural');
    expect(fakeStorageClient.put).toHaveBeenCalledWith('book-1/0/zh-TW-YunJheNeural', {
      ...synthesized,
      durationSeconds: 0,
    });
  });

  test('a voice change does not reuse or invalidate a chunk cached under a different voice', async () => {
    fakeStorageClient.get.mockResolvedValue(undefined);
    fakeTtsClient.synthesize.mockResolvedValue({ audio: new Blob(['fake-audio']), boundaries: [] });
    fakeStorageClient.put.mockResolvedValue({
      url: 'https://blob.example/new.mp3',
      boundaries: [],
    });

    await generateAudioForChunk({
      bookId: 'book-1',
      chunkIndex: 0,
      text: '你好。',
      voice: 'zh-TW-HsiaoYuNeural',
    });

    // Cache lookup and write both go through the new voice's own key - the
    // previously-cached chunk under the old voice is untouched (see ticket 02).
    expect(fakeStorageClient.get).toHaveBeenCalledWith('book-1/0/zh-TW-HsiaoYuNeural');
    expect(fakeStorageClient.put).toHaveBeenCalledWith(
      'book-1/0/zh-TW-HsiaoYuNeural',
      expect.anything(),
    );
  });
});
