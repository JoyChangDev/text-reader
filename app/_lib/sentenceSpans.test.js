import { describe, expect, test } from 'vitest';

import { deriveSentenceSpans } from './sentenceSpans';

describe('deriveSentenceSpans', () => {
  test('derives start/end seconds per sentence from consecutive word boundaries', () => {
    // Arrange
    const text = '你好嗎。我很好。';
    const boundaries = [
      { text: '你好', offset: 0, duration: 10_000_000 },
      { text: '嗎', offset: 10_000_000, duration: 5_000_000 },
      { text: '我很', offset: 20_000_000, duration: 10_000_000 },
      { text: '好', offset: 30_000_000, duration: 5_000_000 },
    ];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toEqual([
      { text: '你好嗎。', startSeconds: 0, endSeconds: 1.5 },
      { text: '我很好。', startSeconds: 2, endSeconds: 3.5 },
    ]);
  });

  test("gives a sentence mapped to exactly one word that word's own start and end", () => {
    // Arrange
    const text = '你好。';
    const boundaries = [{ text: '你好', offset: 0, duration: 10_000_000 }];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toEqual([{ text: '你好。', startSeconds: 0, endSeconds: 1 }]);
  });

  test("falls back to the previous sentence's end for a sentence with zero mapped words", () => {
    // Arrange - splitIntoSentences yields a trailing lone "。" (a punctuation-only
    // sentence with no content characters) after the closing bracket ends the first
    // match early, so no boundary words should be assigned to it.
    const text = '你好嗎。」。';
    const boundaries = [
      { text: '你好', offset: 0, duration: 10_000_000 },
      { text: '嗎', offset: 10_000_000, duration: 5_000_000 },
    ];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toEqual([
      { text: '你好嗎。」', startSeconds: 0, endSeconds: 1.5 },
      { text: '。', startSeconds: 1.5, endSeconds: 1.5 },
    ]);
  });

  test('falls back to zero for a leading zero-word sentence with no prior span', () => {
    // Arrange - a lone leading "。" splits off as its own punctuation-only sentence.
    const text = '。你好。';
    const boundaries = [{ text: '你好', offset: 0, duration: 10_000_000 }];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toEqual([
      { text: '。', startSeconds: 0, endSeconds: 0 },
      { text: '你好。', startSeconds: 0, endSeconds: 1 },
    ]);
  });

  test('tolerates boundary word text with whitespace that does not exactly match the sentence substring', () => {
    // Arrange - edge-tts sometimes pads word text with surrounding whitespace.
    const text = '你好嗎。';
    const boundaries = [
      { text: ' 你好 ', offset: 0, duration: 10_000_000 },
      { text: ' 嗎 ', offset: 10_000_000, duration: 5_000_000 },
    ];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toEqual([{ text: '你好嗎。', startSeconds: 0, endSeconds: 1.5 }]);
  });

  test('does not throw and consumes remaining boundaries when TTS normalization drops content, leaving too few words for later sentences', () => {
    // Arrange - only enough boundary words for the first sentence; the second sentence's
    // words were never synthesized as expected (normalization drift), so it must fall
    // back gracefully instead of throwing or reading past the end of the boundary list.
    const text = '你好嗎。今天天氣真好。';
    const boundaries = [
      { text: '你好', offset: 0, duration: 10_000_000 },
      { text: '嗎', offset: 10_000_000, duration: 5_000_000 },
    ];

    // Act
    const spans = deriveSentenceSpans({ text, boundaries });

    // Assert
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ text: '你好嗎。', startSeconds: 0, endSeconds: 1.5 });
    expect(spans[1]).toEqual({ text: '今天天氣真好。', startSeconds: 1.5, endSeconds: 1.5 });
  });

  test('returns an empty array for empty text', () => {
    // Act
    const spans = deriveSentenceSpans({ text: '', boundaries: [] });

    // Assert
    expect(spans).toEqual([]);
  });
});
