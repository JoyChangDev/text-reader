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

import { generateAudioForChunk, getOrGenerateAudio } from './audioGenerationService';
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
