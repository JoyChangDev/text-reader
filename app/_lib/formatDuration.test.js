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

  // TODO (Lesson 0001): write a test asserting 65 seconds formats as "01:05"
});
