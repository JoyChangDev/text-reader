import { describe, expect, test, vi } from 'vitest';

import { getUsage } from '@/app/_lib/blobCleanupService';

vi.mock('@/app/_lib/blobCleanupService', () => ({
  getUsage: vi.fn(),
}));

const { GET } = await import('./route');

describe('GET /api/blob-usage', () => {
  test('returns the usage reported by getUsage', async () => {
    const usage = { usedBytes: 50, quotaBytes: 100, percent: 50 };
    getUsage.mockResolvedValueOnce(usage);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(usage);
  });

  test('returns a 502 when fetching usage fails', async () => {
    getUsage.mockRejectedValueOnce(new Error('blob list failed'));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
