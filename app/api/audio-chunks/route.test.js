import { describe, expect, test, vi } from 'vitest';

import { generateAudioForChunk } from '@/app/_lib/audioGenerationService';

vi.mock('@/app/_lib/audioGenerationService', () => ({
  generateAudioForChunk: vi.fn(),
}));

const { POST } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/audio-chunks', () => {
  test('rejects a request with an empty text string with 400', async () => {
    const response = await POST(jsonRequest({ bookId: 'book-1', chunkIndex: 0, text: '' }));

    expect(response.status).toBe(400);
    expect(generateAudioForChunk).not.toHaveBeenCalled();
  });

  test('rejects a request missing bookId, chunkIndex, or text with 400', async () => {
    const response = await POST(jsonRequest({ bookId: 'book-1', chunkIndex: 0 }));

    expect(response.status).toBe(400);
    expect(generateAudioForChunk).not.toHaveBeenCalled();
  });

  test('returns the generated result on success', async () => {
    const persisted = { url: 'https://blob.example/chunk.mp3', boundaries: [] };
    generateAudioForChunk.mockResolvedValueOnce(persisted);

    const response = await POST(jsonRequest({ bookId: 'book-1', chunkIndex: 0, text: '你好。' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(persisted);
    expect(generateAudioForChunk).toHaveBeenCalledWith({
      bookId: 'book-1',
      chunkIndex: 0,
      text: '你好。',
    });
  });

  test('returns a 502 when generation fails', async () => {
    generateAudioForChunk.mockRejectedValueOnce(new Error('edge-tts request failed'));

    const response = await POST(jsonRequest({ bookId: 'book-1', chunkIndex: 0, text: '你好。' }));

    expect(response.status).toBe(502);
  });
});
