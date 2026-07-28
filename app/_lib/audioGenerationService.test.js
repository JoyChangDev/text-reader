import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fakeStorageClient, fakeTtsClient } = vi.hoisted(() => ({
  fakeStorageClient: { get: vi.fn(), put: vi.fn() },
  fakeTtsClient: { synthesize: vi.fn() },
}));

vi.mock('./blobStorageClient', () => ({
  createBlobStorageClient: () => fakeStorageClient,
}));
vi.mock('./edgeTtsClient', () => ({
  createEdgeTtsClient: () => fakeTtsClient,
}));

import { generateAudioForChunk, getOrGenerateAudio } from './audioGenerationService';

describe('getOrGenerateAudio', () => {
  let storageClient;
  let ttsClient;

  beforeEach(() => {
    storageClient = { get: vi.fn(), put: vi.fn() };
    ttsClient = { synthesize: vi.fn() };
  });

  test('returns the cached result without calling ttsClient on a cache hit', async () => {
    // Arrange: fake storageClient already has this chunk cached
    const cachedResult = { url: 'https://blob.example/cached.mp3', boundaries: [] };
    storageClient.get.mockResolvedValue(cachedResult);

    // Act
    const result = await getOrGenerateAudio(
      { storageClient, ttsClient },
      { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
    );

    // Assert
    expect(result).toEqual(cachedResult);
    expect(ttsClient.synthesize).not.toHaveBeenCalled();
  });

  test('calls ttsClient and persists the result on a cache miss', async () => {
    // Arrange
    const synthesized = {
      audio: new Blob(['fake-audio']),
      boundaries: [{ text: '你好', offset: 0, duration: 1000 }],
    };
    const persisted = {
      url: 'https://blob.example/generated.mp3',
      boundaries: synthesized.boundaries,
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
    expect(storageClient.put).toHaveBeenCalledWith('book-1/0/zh-TW-default', synthesized);
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
    expect(fakeStorageClient.put).toHaveBeenCalledWith('book-1/0/zh-TW-YunJheNeural', synthesized);
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
