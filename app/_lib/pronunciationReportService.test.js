import { beforeEach, describe, expect, test, vi } from 'vitest';

import { submitReport } from './pronunciationReportService';

describe('pronunciationReportService', () => {
  let storageClient;
  let blobs;

  beforeEach(() => {
    blobs = new Map();
    storageClient = {
      get: async (key) => blobs.get(key),
      putJson: async (key, data) => {
        blobs.set(key, data);
      },
    };
  });

  describe('submitReport', () => {
    test('stores the report with a server-generated timestamp, ignoring any caller-supplied one', async () => {
      vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));

      const report = await submitReport(
        { bookTitle: 'First Book', phrase: '你好', description: 'sounds off', reportedAt: 'bogus' },
        { storageClient },
      );

      expect(report).toEqual({
        bookTitle: 'First Book',
        phrase: '你好',
        description: 'sounds off',
        reportedAt: '2026-07-30T12:00:00.000Z',
      });
      expect(blobs.get('pronunciation-reports/index')).toEqual([report]);

      vi.useRealTimers();
    });

    test('appends to existing reports rather than replacing them', async () => {
      await submitReport({ bookTitle: 'First Book', phrase: '一' }, { storageClient });
      await submitReport({ bookTitle: 'Second Book', phrase: '二' }, { storageClient });

      const reports = blobs.get('pronunciation-reports/index');
      expect(reports).toHaveLength(2);
      expect(reports.map((report) => report.phrase)).toEqual(['一', '二']);
    });

    test('defaults the description to null when none is given, since it is optional', async () => {
      const report = await submitReport(
        { bookTitle: 'First Book', phrase: '你好' },
        { storageClient },
      );

      expect(report.description).toBeNull();
    });
  });
});
