import { describe, expect, test } from 'vitest';

import {
  buildBookTimeline,
  computeSecondsPerChar,
  DEFAULT_SECONDS_PER_CHAR,
  estimateChunkDuration,
  locateBookOffset,
  locateSentenceIndexForOffset,
} from './bookProgress';

describe('estimateChunkDuration', () => {
  test('is character count times the given seconds-per-character ratio', () => {
    expect(estimateChunkDuration(10, 0.2)).toBe(2);
  });

  test('is zero for an empty chunk', () => {
    expect(estimateChunkDuration(0, 0.2)).toBe(0);
  });
});

describe('computeSecondsPerChar', () => {
  test('returns null when no chunk has been generated yet', () => {
    const ratio = computeSecondsPerChar({ chunks: ['你好嗎。'], chunkAudio: {} });

    expect(ratio).toBeNull();
  });

  test('ignores chunks that are still loading or errored', () => {
    const chunks = ['你好嗎。', '我很好。'];
    const chunkAudio = {
      0: { status: 'loading' },
      1: { status: 'error' },
    };

    expect(computeSecondsPerChar({ chunks, chunkAudio })).toBeNull();
  });

  test('derives the ratio from total observed duration over total characters across ready chunks generated for the given voice', () => {
    const chunks = ['一二三四', '五六七八九十'];
    const chunkAudio = {
      0: {
        status: 'ready',
        voice: 'v1',
        boundaries: [{ text: '一二三四', offset: 0, duration: 20_000_000 }],
      },
      1: {
        status: 'ready',
        voice: 'v1',
        boundaries: [{ text: '五六七八九十', offset: 0, duration: 30_000_000 }],
      },
    };

    // (2s + 3s) / (4 + 6) chars = 0.5 s/char
    expect(computeSecondsPerChar({ chunks, chunkAudio, voice: 'v1' })).toBe(0.5);
  });

  test("ignores chunks generated under a different (stale) voice, per ticket 02's prospective-only voice change", () => {
    const chunks = ['一二三四', '五六七八九十'];
    const chunkAudio = {
      // Generated under a voice the Listener has since switched away from.
      0: {
        status: 'ready',
        voice: 'old-voice',
        boundaries: [{ text: '一二三四', offset: 0, duration: 20_000_000 }],
      },
      1: {
        status: 'ready',
        voice: 'new-voice',
        boundaries: [{ text: '五六七八九十', offset: 0, duration: 60_000_000 }],
      },
    };

    // Only chunk 1 (the current voice) counts: 6s / 6 chars = 1 s/char.
    expect(computeSecondsPerChar({ chunks, chunkAudio, voice: 'new-voice' })).toBe(1);
  });
});

describe('buildBookTimeline', () => {
  test('uses the rough default ratio before any chunk has been generated', () => {
    const chunks = ['一二三四五', '六七八九十'];

    const { segments, totalSeconds } = buildBookTimeline({ chunks, chunkAudio: {} });

    expect(segments).toEqual([
      {
        chunkIndex: 0,
        startSeconds: 0,
        endSeconds: 5 * DEFAULT_SECONDS_PER_CHAR,
        durationSeconds: 5 * DEFAULT_SECONDS_PER_CHAR,
        isEstimated: true,
      },
      {
        chunkIndex: 1,
        startSeconds: 5 * DEFAULT_SECONDS_PER_CHAR,
        endSeconds: 10 * DEFAULT_SECONDS_PER_CHAR,
        durationSeconds: 5 * DEFAULT_SECONDS_PER_CHAR,
        isEstimated: true,
      },
    ]);
    expect(totalSeconds).toBe(10 * DEFAULT_SECONDS_PER_CHAR);
  });

  test('replaces a chunk’s estimated duration with its real duration once generated, recalculating totals', () => {
    const chunks = ['一二三四', '五六七八九十'];
    const chunkAudio = {
      0: {
        status: 'ready',
        voice: 'v1',
        boundaries: [{ text: '一二三四', offset: 0, duration: 20_000_000 }],
      },
    };

    const { segments, totalSeconds } = buildBookTimeline({ chunks, chunkAudio, voice: 'v1' });

    expect(segments[0]).toEqual({
      chunkIndex: 0,
      startSeconds: 0,
      endSeconds: 2,
      durationSeconds: 2,
      isEstimated: false,
    });
    // Chunk 1 isn't generated yet - estimated using chunk 0's observed ratio (0.5 s/char).
    expect(segments[1]).toEqual({
      chunkIndex: 1,
      startSeconds: 2,
      endSeconds: 5,
      durationSeconds: 3,
      isEstimated: true,
    });
    expect(totalSeconds).toBe(5);
  });

  test('a chunk generated under a previous voice still contributes its own real duration, but not to the current voice’s ratio', () => {
    const chunks = ['一二三四', '五六七八九十'];
    const chunkAudio = {
      0: {
        status: 'ready',
        voice: 'old-voice',
        boundaries: [{ text: '一二三四', offset: 0, duration: 20_000_000 }],
      },
    };

    const { segments, totalSeconds } = buildBookTimeline({
      chunks,
      chunkAudio,
      voice: 'new-voice',
    });

    // Chunk 0's own real 2s duration still counts (it's what will actually play).
    expect(segments[0]).toMatchObject({ durationSeconds: 2, isEstimated: false });
    // Chunk 1 falls back to the default ratio - chunk 0's old-voice pacing isn't blended in.
    expect(segments[1]).toMatchObject({
      durationSeconds: 6 * DEFAULT_SECONDS_PER_CHAR,
      isEstimated: true,
    });
    expect(totalSeconds).toBe(2 + 6 * DEFAULT_SECONDS_PER_CHAR);
  });

  test('marks a ready chunk with no boundaries as estimated rather than showing a mismatched "generated" style', () => {
    const chunks = ['一二三四'];
    const chunkAudio = { 0: { status: 'ready', voice: 'v1', boundaries: [] } };

    const { segments } = buildBookTimeline({ chunks, chunkAudio, voice: 'v1' });

    expect(segments[0].isEstimated).toBe(true);
    expect(segments[0].durationSeconds).toBe(4 * DEFAULT_SECONDS_PER_CHAR);
  });
});

describe('locateBookOffset', () => {
  const segments = [
    { chunkIndex: 0, startSeconds: 0, endSeconds: 2, durationSeconds: 2, isEstimated: false },
    { chunkIndex: 1, startSeconds: 2, endSeconds: 5, durationSeconds: 3, isEstimated: true },
  ];

  test('finds the segment containing a given book-level time and the offset within it', () => {
    expect(locateBookOffset(segments, 3)).toEqual({ chunkIndex: 1, offsetSeconds: 1 });
  });

  test('clamps a negative target to the very start', () => {
    expect(locateBookOffset(segments, -5)).toEqual({ chunkIndex: 0, offsetSeconds: 0 });
  });

  test('clamps a target past the end to the last segment’s end', () => {
    expect(locateBookOffset(segments, 999)).toEqual({ chunkIndex: 1, offsetSeconds: 3 });
  });

  test('returns null for an empty book', () => {
    expect(locateBookOffset([], 0)).toBeNull();
  });
});

describe('locateSentenceIndexForOffset', () => {
  test('for a generated chunk, finds the sentence span containing the offset', () => {
    const text = '你好嗎。我很好。';
    const boundaries = [
      { text: '你好', offset: 0, duration: 10_000_000 },
      { text: '嗎', offset: 10_000_000, duration: 5_000_000 },
      { text: '我很', offset: 20_000_000, duration: 10_000_000 },
      { text: '好', offset: 30_000_000, duration: 5_000_000 },
    ];

    expect(
      locateSentenceIndexForOffset({
        text,
        boundaries,
        offsetSeconds: 2.5,
        chunkDurationSeconds: 3.5,
      }),
    ).toBe(1);
  });

  test('for a not-yet-generated chunk, distributes proportionally by sentence character length', () => {
    // Two 4-char sentences over an estimated 4-second chunk: the second sentence
    // starts halfway through.
    const text = '一二三。四五六。';

    expect(
      locateSentenceIndexForOffset({
        text,
        boundaries: [],
        offsetSeconds: 3,
        chunkDurationSeconds: 4,
      }),
    ).toBe(1);
  });

  test('returns 0 for a chunk with no sentences', () => {
    expect(
      locateSentenceIndexForOffset({
        text: '',
        boundaries: [],
        offsetSeconds: 0,
        chunkDurationSeconds: 0,
      }),
    ).toBe(0);
  });
});
