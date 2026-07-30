import { beforeEach, describe, expect, test, vi } from 'vitest';

import { submitReport } from './pronunciationReports';

describe('pronunciationReports', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe('submitReport', () => {
    test('POSTs to /api/pronunciation-reports and returns the stored report', async () => {
      const report = {
        bookTitle: 'First Book',
        phrase: '你好',
        description: 'sounds off',
        reportedAt: '2026-07-30T12:00:00.000Z',
      };
      global.fetch.mockResolvedValue(new Response(JSON.stringify(report), { status: 201 }));

      const result = await submitReport({
        bookTitle: 'First Book',
        phrase: '你好',
        description: 'sounds off',
      });

      expect(result).toEqual(report);
      expect(global.fetch).toHaveBeenCalledWith('/api/pronunciation-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookTitle: 'First Book',
          phrase: '你好',
          description: 'sounds off',
        }),
      });
    });

    test('throws when the response is not ok, rather than resolving as if it succeeded', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'bookTitle and phrase are required' }), {
          status: 400,
        }),
      );

      await expect(
        submitReport({ bookTitle: 'First Book', phrase: '你好', description: '' }),
      ).rejects.toThrow();
    });
  });
});
