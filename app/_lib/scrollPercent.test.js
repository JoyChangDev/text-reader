import { describe, expect, test } from 'vitest';

import { computeScrollPercent, scrollableRange } from './scrollPercent';

describe('scrollableRange', () => {
  test('is the difference between scrollHeight and clientHeight', () => {
    expect(scrollableRange({ scrollHeight: 1000, clientHeight: 500 })).toBe(500);
  });
});

describe('computeScrollPercent', () => {
  test('returns the scroll position as a percentage of the scrollable range', () => {
    const container = { scrollHeight: 1000, clientHeight: 500, scrollTop: 250 };

    expect(computeScrollPercent(container)).toBe(50);
  });

  test('returns 0 when the container has no scrollable range, rather than dividing by zero', () => {
    const container = { scrollHeight: 500, clientHeight: 500, scrollTop: 0 };

    expect(computeScrollPercent(container)).toBe(0);
  });

  test('returns 0 for a null container', () => {
    expect(computeScrollPercent(null)).toBe(0);
  });
});
