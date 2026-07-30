import { describe, expect, test, vi } from 'vitest';

import { listReports, submitReport } from '@/app/_lib/pronunciationReportService';

vi.mock('@/app/_lib/pronunciationReportService', () => ({
  listReports: vi.fn(),
  submitReport: vi.fn(),
}));

const { GET, POST } = await import('./route');

function jsonRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('GET /api/pronunciation-reports', () => {
  test('returns the reports from listReports', async () => {
    const reports = [
      { bookTitle: 'First Book', phrase: '你好', reportedAt: '2026-07-30T12:00:00.000Z' },
    ];
    listReports.mockResolvedValueOnce(reports);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ reports });
  });

  test('returns a 502 when listing fails', async () => {
    listReports.mockRejectedValueOnce(new Error('blob get failed'));

    const response = await GET();

    expect(response.status).toBe(502);
  });
});

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
