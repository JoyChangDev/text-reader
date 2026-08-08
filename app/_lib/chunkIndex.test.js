import { describe, expect, test } from 'vitest';

import { deriveSegmentUrl, readIndexedRun, storeBase } from './chunkIndex';

describe('storeBase', () => {
  test('is the origin a blob URL sits on, recovered by removing its pathname', () => {
    expect(
      storeBase({
        url: 'https://abc123.public.blob.vercel-storage.com/book-1/7/voice-a.mp3',
        pathname: 'book-1/7/voice-a.mp3',
      }),
    ).toBe('https://abc123.public.blob.vercel-storage.com/');
  });
});

describe('deriveSegmentUrl', () => {
  test('rebuilds the segment URL from the store base and the cache key', () => {
    expect(
      deriveSegmentUrl('https://abc123.public.blob.vercel-storage.com/', {
        bookId: 'book-1',
        chunkIndex: 7,
        voice: 'voice-a',
      }),
    ).toBe('https://abc123.public.blob.vercel-storage.com/book-1/7/voice-a.mp3');
  });
});

describe('readIndexedRun', () => {
  const base = 'https://abc123.public.blob.vercel-storage.com/';
  const book = { bookId: 'book-1', voice: 'voice-a', chunkCount: 5 };

  test('returns one entry per Chunk index, undefined where not indexed', () => {
    const run = readIndexedRun(
      { base, durations: { 0: '12.5', 1: '11.25' } },
      { ...book, from: 0 },
    );

    expect(run).toHaveLength(5);
    expect(run[0]).toEqual({
      url: `${base}book-1/0/voice-a.mp3`,
      durationSeconds: 12.5,
    });
    expect(run[2]).toBeUndefined();
  });

  // The client returns hash values as strings from HGETALL and as numbers from HMGET, so
  // the coercion has to be explicit - a string reaching the playlist becomes #EXTINF:"12.5".
  test('coerces durations to numbers whichever way the client returned them', () => {
    const run = readIndexedRun({ base, durations: { 0: '12.5', 1: 11.25 } }, { ...book, from: 0 });

    expect(run[0].durationSeconds).toBe(12.5);
    expect(run[1].durationSeconds).toBe(11.25);
  });

  test('stops at the first gap, matching what the playlist does with one', () => {
    const run = readIndexedRun(
      { base, durations: { 0: '12', 1: '12', 3: '12' } },
      { ...book, from: 0 },
    );

    expect(run[1]).toBeDefined();
    expect(run[2]).toBeUndefined();
    expect(run[3]).toBeUndefined();
  });

  test('scans from `from`, so a Listener who jumped a gap still gets a run', () => {
    const run = readIndexedRun(
      { base, durations: { 0: '12', 3: '12', 4: '12' } },
      { ...book, from: 3 },
    );

    expect(run[3]).toBeDefined();
    expect(run[4]).toBeDefined();
    // Behind the start: not scanned, so not reported, exactly as the Blob scan behaves.
    expect(run[0]).toBeUndefined();
  });

  // A value that can't be a duration is treated as absent, so where it sits decides what
  // happens: at the start it is a miss (ask Blob), mid-run it is a gap like any other.
  test('is a miss when the Chunk at `from` has a non-numeric or zero duration', () => {
    expect(
      readIndexedRun({ base, durations: { 0: 'nonsense', 1: '12' } }, { ...book, from: 0 }),
    ).toBeUndefined();
    expect(
      readIndexedRun({ base, durations: { 0: '0', 1: '12' } }, { ...book, from: 0 }),
    ).toBeUndefined();
  });

  test('truncates at a non-numeric or zero duration found mid-run', () => {
    const run = readIndexedRun(
      { base, durations: { 0: '12', 1: '0', 2: '12' } },
      { ...book, from: 0 },
    );

    expect(run[0]).toBeDefined();
    expect(run[1]).toBeUndefined();
    expect(run[2]).toBeUndefined();
  });

  test('is a miss when the store base was never recorded', () => {
    expect(
      readIndexedRun({ base: null, durations: { 0: '12' } }, { ...book, from: 0 }),
    ).toBeUndefined();
  });

  test('is a miss when nothing is indexed at all, so the caller falls back to Blob', () => {
    expect(readIndexedRun({ base, durations: {} }, { ...book, from: 0 })).toBeUndefined();
    expect(readIndexedRun({ base, durations: null }, { ...book, from: 0 })).toBeUndefined();
  });
});
