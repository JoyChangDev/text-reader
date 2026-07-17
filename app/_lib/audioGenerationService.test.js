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

  // TODO (Lesson 0003): write a test asserting that on a cache miss —
  // storageClient.get resolves to undefined — getOrGenerateAudio calls
  // ttsClient.synthesize(text, voice), persists the result via storageClient.put,
  // and returns the generated result. See lesson 0003 for the pattern.
  test.todo('calls ttsClient and persists the result on a cache miss');
});
