import { describe, expect, test } from 'vitest';

import { chunkFetchPlan } from './chunkFetchPlan';

describe('chunkFetchPlan', () => {
  test('plans the current chunk plus the look-ahead window when all are idle', () => {
    const plan = chunkFetchPlan({ totalChunks: 10, currentIndex: 3, lookahead: 2, statuses: {} });

    expect(plan).toEqual([3, 4, 5]);
  });

  test('excludes chunks that are already loading or ready', () => {
    const plan = chunkFetchPlan({
      totalChunks: 10,
      currentIndex: 3,
      lookahead: 2,
      statuses: { 3: 'ready', 4: 'loading' },
    });

    expect(plan).toEqual([5]);
  });

  test('does not automatically retry a chunk in error state', () => {
    const plan = chunkFetchPlan({
      totalChunks: 10,
      currentIndex: 3,
      lookahead: 2,
      statuses: { 4: 'error' },
    });

    expect(plan).toEqual([3, 5]);
  });

  test('clamps the window at the end of the book', () => {
    const plan = chunkFetchPlan({ totalChunks: 5, currentIndex: 4, lookahead: 2, statuses: {} });

    expect(plan).toEqual([4]);
  });

  test('returns an empty plan when there are no chunks', () => {
    const plan = chunkFetchPlan({ totalChunks: 0, currentIndex: 0, lookahead: 2, statuses: {} });

    expect(plan).toEqual([]);
  });
});
