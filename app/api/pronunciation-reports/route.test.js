import { describe, expect, test, vi } from 'vitest';

import { submitReport } from '@/app/_lib/pronunciationReportService';

vi.mock('@/app/_lib/pronunciationReportService', () => ({
  submitReport: vi.fn(),
}));

const { POST } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/pronunciation-reports', () => {
  test('rejects a request missing bookTitle or phrase with 400', async () => {
    const response = await POST(jsonRequest({ bookTitle: 'First Book' }));

    expect(response.status).toBe(400);
    expect(submitReport).not.toHaveBeenCalled();
  });

  test('submits the report and returns it', async () => {
    const report = {
      bookTitle: 'First Book',
      phrase: '你好',
      description: 'sounds off',
      reportedAt: '2026-07-30T12:00:00.000Z',
    };
    submitReport.mockResolvedValueOnce(report);

    const response = await POST(
      jsonRequest({ bookTitle: 'First Book', phrase: '你好', description: 'sounds off' }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(report);
    expect(submitReport).toHaveBeenCalledWith({
      bookTitle: 'First Book',
      phrase: '你好',
      description: 'sounds off',
    });
  });

  test('returns a 502 when submitting fails', async () => {
    submitReport.mockRejectedValueOnce(new Error('blob put failed'));

    const response = await POST(jsonRequest({ bookTitle: 'First Book', phrase: '你好' }));

    expect(response.status).toBe(502);
  });
});
