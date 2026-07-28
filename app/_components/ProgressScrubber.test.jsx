import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import ProgressScrubber from './ProgressScrubber';

const segments = [
  { chunkIndex: 0, startSeconds: 0, endSeconds: 10, durationSeconds: 10, isEstimated: false },
  { chunkIndex: 1, startSeconds: 10, endSeconds: 25, durationSeconds: 15, isEstimated: true },
];

function renderScrubber(overrides = {}) {
  return render(
    <ChakraProvider>
      <ProgressScrubber
        segments={segments}
        totalSeconds={25}
        currentTimeSeconds={4}
        onSeek={() => {}}
        {...overrides}
      />
    </ChakraProvider>,
  );
}

describe('ProgressScrubber', () => {
  test('renders one segment per chunk, marking generated vs estimated ones', () => {
    renderScrubber();

    expect(screen.getByTestId('scrubber-segment-0')).not.toHaveAttribute('data-estimated');
    expect(screen.getByTestId('scrubber-segment-1')).toHaveAttribute('data-estimated', 'true');
  });

  test('shows the current position and total book duration, formatted as mm:ss', () => {
    renderScrubber({ currentTimeSeconds: 65, totalSeconds: 125 });

    expect(screen.getByText('01:05 / 02:05')).toBeInTheDocument();
  });

  test('exposes a range slider spanning the whole book, at the current position', () => {
    renderScrubber({ currentTimeSeconds: 4, totalSeconds: 25 });

    const slider = screen.getByRole('slider', { name: /book progress/i });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '25');
    expect(slider).toHaveValue('4');
  });

  test('dragging the slider to a point reports the target book-level seconds via onSeek', () => {
    const onSeek = vi.fn();
    renderScrubber({ onSeek });

    fireEvent.change(screen.getByRole('slider', { name: /book progress/i }), {
      target: { value: '18' },
    });

    expect(onSeek).toHaveBeenCalledWith(18);
  });

  test('disables the slider when the book has no measurable duration yet', () => {
    renderScrubber({ segments: [], totalSeconds: 0, currentTimeSeconds: 0 });

    expect(screen.getByRole('slider', { name: /book progress/i })).toBeDisabled();
  });
});
