import { describe, expect, test } from 'vitest';

import { summarizeBookProgress } from './bookProgress';

describe('summarizeBookProgress', () => {
  test('returns null when totalChunks is missing (legacy library entries)', () => {
    expect(summarizeBookProgress({ resumeIndex: 3 })).toBeNull();
  });

  test('returns null for a single-chunk book - resumeIndex alone cannot distinguish opened from unopened', () => {
    expect(summarizeBookProgress({ resumeIndex: 0, totalChunks: 1 })).toBeNull();
  });

  test('reports 0% and not complete at the very first chunk', () => {
    expect(summarizeBookProgress({ resumeIndex: 0, totalChunks: 5 })).toEqual({
      percent: 0,
      isComplete: false,
    });
  });

  test('reports a proportional percent partway through', () => {
    expect(summarizeBookProgress({ resumeIndex: 2, totalChunks: 5 })).toEqual({
      percent: 50,
      isComplete: false,
    });
  });

  test('reports 100% and complete at the last chunk', () => {
    expect(summarizeBookProgress({ resumeIndex: 4, totalChunks: 5 })).toEqual({
      percent: 100,
      isComplete: true,
    });
  });

  test('clamps an out-of-range resumeIndex instead of producing a percent outside 0-100', () => {
    expect(summarizeBookProgress({ resumeIndex: 99, totalChunks: 5 })).toEqual({
      percent: 100,
      isComplete: true,
    });
    expect(summarizeBookProgress({ resumeIndex: -1, totalChunks: 5 })).toEqual({
      percent: 0,
      isComplete: false,
    });
  });
});
