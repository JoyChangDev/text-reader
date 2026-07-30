import { describe, expect, test } from 'vitest';

import { summarizeBookProgress, summarizeSentenceProgress } from './bookProgress';

describe('summarizeBookProgress', () => {
  test('returns null when totalChunks is missing (legacy library entries)', () => {
    expect(summarizeBookProgress({ resumeIndex: 3 })).toBeNull();
  });

  test('returns null for a single-chunk book - resumeIndex alone cannot distinguish opened from unopened', () => {
    expect(summarizeBookProgress({ resumeIndex: 0, totalChunks: 1 })).toBeNull();
  });

  test('prefers Sentence-level data over Chunk-level data when both are present', () => {
    // Sentence-level (2 of 4 sentences reached -> 67%) differs from what the Chunk-level
    // fallback would report (resumeIndex 1 of 5 chunks -> 25%), proving Sentence data wins.
    expect(
      summarizeBookProgress({
        resumeIndex: 1,
        totalChunks: 5,
        resumeSentenceIndex: 0,
        sentenceCountsByChunk: [2, 2],
      }),
    ).toEqual({ percent: 67, isComplete: false });
  });

  test('falls back to Chunk-level data when sentenceCountsByChunk is absent (legacy entries)', () => {
    expect(
      summarizeBookProgress({ resumeIndex: 2, totalChunks: 5, resumeSentenceIndex: undefined }),
    ).toEqual({ percent: 50, isComplete: false });
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

describe('summarizeSentenceProgress', () => {
  test('returns null for a single-Sentence book - resume position alone cannot distinguish opened from unopened', () => {
    expect(
      summarizeSentenceProgress({
        resumeIndex: 0,
        resumeSentenceIndex: 0,
        sentenceCountsByChunk: [1],
      }),
    ).toBeNull();
  });

  test('reports 0% and not complete at the very first Sentence', () => {
    expect(
      summarizeSentenceProgress({
        resumeIndex: 0,
        resumeSentenceIndex: 0,
        sentenceCountsByChunk: [3, 2],
      }),
    ).toEqual({ percent: 0, isComplete: false });
  });

  test('reports a proportional percent partway through, counting Sentences from earlier Chunks', () => {
    // 5 total Sentences (3 + 2); resumed at chunk 1, sentence 0 -> ordinal 3 of 4.
    expect(
      summarizeSentenceProgress({
        resumeIndex: 1,
        resumeSentenceIndex: 0,
        sentenceCountsByChunk: [3, 2],
      }),
    ).toEqual({ percent: 75, isComplete: false });
  });

  test('reports 100% and complete at the very last Sentence', () => {
    expect(
      summarizeSentenceProgress({
        resumeIndex: 1,
        resumeSentenceIndex: 1,
        sentenceCountsByChunk: [3, 2],
      }),
    ).toEqual({ percent: 100, isComplete: true });
  });

  test('clamps an out-of-range resume position instead of producing a percent outside 0-100', () => {
    expect(
      summarizeSentenceProgress({
        resumeIndex: 99,
        resumeSentenceIndex: 99,
        sentenceCountsByChunk: [3, 2],
      }),
    ).toEqual({ percent: 100, isComplete: true });
    expect(
      summarizeSentenceProgress({
        resumeIndex: -1,
        resumeSentenceIndex: -1,
        sentenceCountsByChunk: [3, 2],
      }),
    ).toEqual({ percent: 0, isComplete: false });
  });

  test('handles a single-Chunk book (all Sentences counted within one Chunk)', () => {
    expect(
      summarizeSentenceProgress({
        resumeIndex: 0,
        resumeSentenceIndex: 2,
        sentenceCountsByChunk: [4],
      }),
    ).toEqual({ percent: 67, isComplete: false });
  });

  test('defaults resumeSentenceIndex to 0 when omitted', () => {
    expect(summarizeSentenceProgress({ resumeIndex: 1, sentenceCountsByChunk: [3, 2] })).toEqual({
      percent: 75,
      isComplete: false,
    });
  });
});
