import { describe, expect, test, vi } from 'vitest';

import { cleanupBlobs } from '@/app/_lib/blobCleanupService';

vi.mock('@/app/_lib/blobCleanupService', () => ({
  cleanupBlobs: vi.fn(),
}));

const { GET, POST } = await import('./route');

describe('POST /api/blob-cleanup', () => {
  test('returns the pathnames cleanupBlobs deleted', async () => {
    cleanupBlobs.mockResolvedValueOnce({ deleted: ['book-1/0/voice-a.mp3'] });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: ['book-1/0/voice-a.mp3'] });
  });

  test('returns a 502 when cleanup fails', async () => {
    cleanupBlobs.mockRejectedValueOnce(new Error('blob del failed'));

    const response = await POST();

    expect(response.status).toBe(502);
  });
});

// Vercel Cron always invokes its target path with GET, not POST - this route must
// answer both so vercel.json's daily cron trigger actually runs the sweep.
describe('GET /api/blob-cleanup', () => {
  test('returns the pathnames cleanupBlobs deleted', async () => {
    cleanupBlobs.mockResolvedValueOnce({ deleted: ['book-1/0/voice-a.mp3'] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: ['book-1/0/voice-a.mp3'] });
  });

  test('returns a 502 when cleanup fails', async () => {
    cleanupBlobs.mockRejectedValueOnce(new Error('blob del failed'));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
