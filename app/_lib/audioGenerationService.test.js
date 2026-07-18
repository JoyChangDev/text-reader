import { describe, expect, test, vi } from 'vitest';

import { getOrGenerateAudio } from './audioGenerationService';

describe('getOrGenerateAudio', () => {
  test('returns the cached result without calling ttsClient on a cache hit', async () => {
    // Arrange: fake storageClient already has this chunk cached
    const cachedResult = { url: 'https://blob.example/cached.mp3', boundaries: [] };
    const storageClient = {
      get: vi.fn().mockResolvedValue(cachedResult),
      put: vi.fn(),
    };
    const ttsClient = {
      synthesize: vi.fn(),
    };

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
    const storageClient = {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(persisted),
    };
    const ttsClient = {
      synthesize: vi.fn().mockResolvedValue(synthesized),
    };

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
    const storageClient = {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn(),
    };
    const ttsClient = {
      synthesize: vi.fn().mockRejectedValue(new Error('edge-tts request failed')),
    };

    // Act / Assert
    await expect(
      getOrGenerateAudio(
        { storageClient, ttsClient },
        { bookId: 'book-1', chunkIndex: 0, voice: 'zh-TW-default', text: '你好。' },
      ),
    ).rejects.toThrow('edge-tts request failed');
    expect(storageClient.put).not.toHaveBeenCalled();
  });
});
