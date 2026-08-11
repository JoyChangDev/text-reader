import { describe, expect, test } from 'vitest';

import { formatBytes, summariseObjects } from './r2-summary.mjs';

const object = (pathname, size, uploadedAt) => ({ pathname, size, uploadedAt });

describe('summariseObjects', () => {
  test('groups the listing by top-level prefix, which is one Book each', () => {
    const summary = summariseObjects([
      object('book-a/0/voice.mp3', 100, '2026-08-10T17:00:00.000Z'),
      object('book-a/0/voice.json', 10, '2026-08-10T17:00:01.000Z'),
      object('book-b/0/voice.mp3', 200, '2026-08-10T18:00:00.000Z'),
    ]);

    expect(summary.count).toBe(3);
    expect(summary.bytes).toBe(310);
    expect(summary.groups).toEqual([
      expect.objectContaining({ prefix: 'book-b/', count: 1, bytes: 200 }),
      expect.objectContaining({ prefix: 'book-a/', count: 2, bytes: 110 }),
    ]);
  });

  // The measurement ticket 05 takes attributes objects to a run by when they were written -
  // the look-ahead's Chunks and the measured range are separated by nothing else.
  test('reports the window each prefix was written in', () => {
    const [group] = summariseObjects([
      object('book-a/1/voice.mp3', 1, '2026-08-10T17:42:29.000Z'),
      object('book-a/0/voice.mp3', 1, '2026-08-10T17:40:50.000Z'),
      object('book-a/2/voice.mp3', 1, '2026-08-10T17:41:10.000Z'),
    ]).groups;

    expect(group.firstWrite).toBe('2026-08-10T17:40:50.000Z');
    expect(group.lastWrite).toBe('2026-08-10T17:42:29.000Z');
  });

  // The whole point of taking a baseline: what a measured run stored, separated from
  // everything that was already in the bucket before it started.
  test('counts separately what was written after a given moment', () => {
    const summary = summariseObjects(
      [
        object('book-a/0/voice.mp3', 100, '2026-08-10T17:00:00.000Z'),
        object('book-a/1/voice.mp3', 200, '2026-08-11T09:30:00.000Z'),
        object('book-a/2/voice.mp3', 300, '2026-08-11T09:31:00.000Z'),
      ],
      { since: '2026-08-11T09:00:00.000Z' },
    );

    expect(summary.since).toEqual({ count: 2, bytes: 500 });
    expect(summary.count).toBe(3);
  });

  test('leaves the since figures out entirely when no moment was given', () => {
    expect(summariseObjects([object('book-a/0/voice.mp3', 1, undefined)]).since).toBeUndefined();
  });

  // listObjectsXml.js reports a record whose LastModified it could not read rather than
  // dropping it, so the object still has to be counted - it occupies the bucket either way.
  // It just cannot be attributed to a window, and must not drag one to an epoch.
  test('still counts an object whose write time the listing did not carry', () => {
    const [group] = summariseObjects([
      object('book-a/0/voice.mp3', 100, undefined),
      object('book-a/1/voice.mp3', 100, '2026-08-10T17:00:00.000Z'),
    ]).groups;

    expect(group.count).toBe(2);
    expect(group.bytes).toBe(200);
    expect(group.firstWrite).toBe('2026-08-10T17:00:00.000Z');
  });

  test('does not count an undated object as part of a since window', () => {
    const summary = summariseObjects([object('book-a/0/voice.mp3', 100, undefined)], {
      since: '2026-08-11T09:00:00.000Z',
    });

    expect(summary.since).toEqual({ count: 0, bytes: 0 });
  });

  // A key at the root of the bucket belongs to no Book, so it would otherwise be invisible
  // in a summary that only knows about prefixes - and an object nothing accounts for is
  // exactly what this is being run to find.
  test('gives a key with no prefix a group of its own', () => {
    const summary = summariseObjects([object('stray.json', 5, '2026-08-10T17:00:00.000Z')]);

    expect(summary.groups).toEqual([expect.objectContaining({ prefix: '(root)', count: 1 })]);
  });

  test('answers with nothing rather than failing on an empty bucket', () => {
    expect(summariseObjects([])).toEqual({ count: 0, bytes: 0, groups: [], since: undefined });
  });
});

describe('formatBytes', () => {
  // Decimal, not binary, because the quota it is read against is: blobCleanupService.js
  // bills against 10^10 for R2's 10 GB, and a GiB here would report a different percentage
  // from the capacity indicator over the same bucket.
  test('counts a gigabyte as Cloudflare bills one', () => {
    expect(formatBytes(10_000_000_000)).toBe('10.00 GB');
    expect(formatBytes(1_500_000)).toBe('1.50 MB');
  });

  test('leaves small objects in bytes, where rounding would say 0.00 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(940)).toBe('940 B');
  });
});
