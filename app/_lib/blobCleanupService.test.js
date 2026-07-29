import { beforeEach, describe, expect, test, vi } from 'vitest';

import { cleanupBlobs, computeUsagePercent, getUsage, planCleanup } from './blobCleanupService';

describe('planCleanup', () => {
  const now = new Date('2026-01-08T00:00:00Z');

  test('returns pathnames older than retentionDays', () => {
    const blobs = [
      { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual(['book-1/0/voice-a.mp3']);
  });

  test('excludes pathnames newer than retentionDays', () => {
    const blobs = [
      { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date('2026-01-05T00:00:00Z') },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual([]);
  });

  test('includes a blob uploaded exactly retentionDays ago (boundary)', () => {
    const blobs = [
      { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual(['book-1/0/voice-a.mp3']);
  });

  test('excludes a blob one millisecond newer than the retention threshold', () => {
    const blobs = [
      {
        pathname: 'book-1/0/voice-a.mp3',
        size: 100,
        uploadedAt: new Date('2026-01-01T00:00:00.001Z'),
      },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual([]);
  });

  test('never includes library/* blobs, even when stale', () => {
    const blobs = [
      { pathname: 'library/index.json', size: 100, uploadedAt: new Date('2026-01-01T00:00:00Z') },
      {
        pathname: 'library/book-1/chunks.json',
        size: 100,
        uploadedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual([]);
  });

  test('never includes pronunciation-reports/* blobs, even when stale', () => {
    const blobs = [
      {
        pathname: 'pronunciation-reports/index.json',
        size: 100,
        uploadedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    expect(planCleanup({ blobs, now, retentionDays: 7 })).toEqual([]);
  });

  test('returns an empty array for zero blobs', () => {
    expect(planCleanup({ blobs: [], now, retentionDays: 7 })).toEqual([]);
  });

  test('defaults retentionDays to 7', () => {
    const blobs = [
      { pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date('2026-01-01T00:00:00Z') },
    ];

    expect(planCleanup({ blobs, now })).toEqual(['book-1/0/voice-a.mp3']);
  });
});

describe('computeUsagePercent', () => {
  test('computes the percentage of quota used', () => {
    const blobs = [
      { pathname: 'book-1/0/voice-a.mp3', size: 25, uploadedAt: new Date() },
      { pathname: 'book-1/0/voice-a.json', size: 25, uploadedAt: new Date() },
    ];

    expect(computeUsagePercent({ blobs, quotaBytes: 100 })).toBe(50);
  });

  test('returns 0 for zero blobs', () => {
    expect(computeUsagePercent({ blobs: [], quotaBytes: 100 })).toBe(0);
  });

  test('returns 100 when usage exactly reaches quota', () => {
    const blobs = [{ pathname: 'book-1/0/voice-a.mp3', size: 100, uploadedAt: new Date() }];

    expect(computeUsagePercent({ blobs, quotaBytes: 100 })).toBe(100);
  });
});

describe('getUsage', () => {
  let storageClient;

  beforeEach(() => {
    storageClient = { list: vi.fn(), del: vi.fn() };
  });

  test('sums blob sizes and reports the configured quota and percent', async () => {
    storageClient.list.mockResolvedValue([
      { pathname: 'book-1/0/voice-a.mp3', size: 30, uploadedAt: new Date() },
      { pathname: 'book-1/0/voice-a.json', size: 20, uploadedAt: new Date() },
    ]);

    const usage = await getUsage({ storageClient }, { quotaBytes: 100 });

    expect(usage).toEqual({ usedBytes: 50, quotaBytes: 100, percent: 50 });
  });
});

describe('cleanupBlobs', () => {
  let storageClient;

  beforeEach(() => {
    storageClient = { list: vi.fn(), del: vi.fn().mockResolvedValue(undefined) };
  });

  test('deletes only the pathnames planCleanup identifies', async () => {
    const now = new Date('2026-01-08T00:00:00Z');
    storageClient.list.mockResolvedValue([
      { pathname: 'book-1/0/voice-a.mp3', size: 30, uploadedAt: new Date('2026-01-01T00:00:00Z') },
      { pathname: 'book-2/0/voice-a.mp3', size: 30, uploadedAt: new Date('2026-01-07T00:00:00Z') },
      { pathname: 'library/index.json', size: 10, uploadedAt: new Date('2026-01-01T00:00:00Z') },
    ]);

    const result = await cleanupBlobs({ storageClient }, { now, retentionDays: 7 });

    expect(storageClient.del).toHaveBeenCalledTimes(1);
    expect(storageClient.del).toHaveBeenCalledWith('book-1/0/voice-a.mp3');
    expect(result).toEqual({ deleted: ['book-1/0/voice-a.mp3'] });
  });
});
