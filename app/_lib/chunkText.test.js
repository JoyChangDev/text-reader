import { describe, expect, test } from 'vitest';

import { chunkText } from './chunkText';

describe('chunkText', () => {
  test('splits a paragraph into chunks that each end on a sentence boundary', () => {
    // Arrange
    const text =
      '今天天氣很好。我們去公園散步。路上遇到了朋友！大家一起聊天。晚上回家吃飯了。她煮了我最喜歡的菜？真是美好的一天。';

    // Act
    const chunks = chunkText(text);

    // Assert
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/[。！？]$/);
    }
  });

  test('no chunk exceeds the configured maximum character count', () => {
    // Arrange
    const text =
      '這是第一句話。這是第二句話。這是第三句話。這是第四句話。這是第五句話。這是第六句話。';
    const maxChars = 20;

    // Act
    const chunks = chunkText(text, { maxChars });

    // Assert
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
  });

  test('groups sentences in batches of roughly 2-4, not one sentence per chunk', () => {
    // Arrange
    const text = '一。二。三。四。五。六。七。八。';

    // Act
    const chunks = chunkText(text, { maxChars: 200 });

    // Assert
    expect(chunks.length).toBeLessThan(8);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('returns a single chunk for text shorter than one full chunk', () => {
    // Arrange
    const text = '你好。';

    // Act
    const chunks = chunkText(text);

    // Assert
    expect(chunks).toEqual(['你好。']);
  });

  test('includes trailing text with no terminal punctuation as its own chunk', () => {
    // Arrange
    const text = '第一句話。這句話沒有結尾標點';

    // Act
    const chunks = chunkText(text, { maxChars: 10 });

    // Assert
    expect(chunks.join('')).toBe(text);
    expect(chunks.at(-1)).toBe('這句話沒有結尾標點');
  });

  test('preserves trailing text with no terminal punctuation when it fits in the same chunk', () => {
    // Arrange
    const text = '第一句話。這句話沒有結尾標點';

    // Act
    const chunks = chunkText(text);

    // Assert
    expect(chunks).toEqual([text]);
  });

  test('keeps consecutive punctuation marks attached to the same sentence', () => {
    // Arrange
    const text = '他說了一句話。」接著就離開了。';

    // Act
    const chunks = chunkText(text);

    // Assert
    expect(chunks.join('')).toBe(text);
    expect(chunks[0].startsWith('他說了一句話。」')).toBe(true);
  });

  test('hard-splits a single sentence that alone exceeds the maximum character count', () => {
    // Arrange
    const longSentence = '字'.repeat(50) + '。';
    const maxChars = 20;

    // Act
    const chunks = chunkText(longSentence, { maxChars });

    // Assert
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
    expect(chunks.join('')).toBe(longSentence);
  });
});
