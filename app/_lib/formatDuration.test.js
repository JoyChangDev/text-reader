import { describe, expect, test } from 'vitest';

import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  test('formats zero seconds as 00:00', () => {
    // Arrange
    const totalSeconds = 0;

    // Act
    const result = formatDuration(totalSeconds);

    // Assert
    expect(result).toBe('00:00');
  });

  // TODO (Lesson 0001): write a test asserting 5 seconds formats as "00:05"
  test('formats 5 seconds as 00:05', () => {
    const totalSeconds = 5;
    const result = formatDuration(totalSeconds);
    expect(result).toBe('00:05');
  });

  // TODO (Lesson 0001): write a test asserting 65 seconds formats as "01:05"
  test('formats 65 seconds as 01:05', () => {
    const totalSeconds = 65;
    const result = formatDuration(totalSeconds);
    expect(result).toBe('01:05');
  });
});
