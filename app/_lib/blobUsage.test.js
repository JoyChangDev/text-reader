import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cleanupBlobs, getUsage } from './blobUsage';

describe('blobUsage', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe('getUsage', () => {
    test('GETs /api/blob-usage and returns the usage', async () => {
      const usage = { usedBytes: 50, quotaBytes: 100, percent: 50 };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(usage), { status: 200 }));

      const result = await getUsage();

      expect(result).toEqual(usage);
      expect(global.fetch).toHaveBeenCalledWith('/api/blob-usage');
    });
  });

  describe('cleanupBlobs', () => {
    test('POSTs /api/blob-cleanup and returns the deleted pathnames', async () => {
      const result = { deleted: ['book-1/0/voice-a.mp3'] };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

      const response = await cleanupBlobs();

      expect(response).toEqual(result);
      expect(global.fetch).toHaveBeenCalledWith('/api/blob-cleanup', { method: 'POST' });
    });
  });
});
