import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getOrGenerateAudio } from './audioGenerationService';

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
