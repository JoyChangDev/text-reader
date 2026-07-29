import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import TranscriptView from './TranscriptView';

const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];

describe('TranscriptView', () => {
  beforeEach(() => {
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders every chunk as sentences and marks the active one', () => {
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    expect(screen.getByTestId('sentence-0-0')).toHaveTextContent('第一句。');
    expect(screen.getByTestId('sentence-0-1')).toHaveTextContent('第二句。');
    expect(screen.getByTestId('sentence-1-0')).toHaveTextContent('第三句。');
    expect(screen.getByTestId('sentence-1-1')).toHaveTextContent('第四句。');

    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sentence-0-0')).not.toHaveAttribute('data-active');
    // Only the current chunk's sentences can be active, even if another chunk
    // happens to share the same sentence index.
    expect(screen.getByTestId('sentence-1-1')).not.toHaveAttribute('data-active');
  });

  test('calls onSentenceClick with the chunk and sentence index that was clicked, while not playing', () => {
    const onSentenceClick = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          isPlaying={false}
          onSentenceClick={onSentenceClick}
        />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByTestId('sentence-1-0'));

    expect(onSentenceClick).toHaveBeenCalledWith(1, 0);
  });

  test('does not call onSentenceClick when a sentence is clicked while playing', () => {
    const onSentenceClick = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          isPlaying={true}
          onSentenceClick={onSentenceClick}
        />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByTestId('sentence-1-0'));

    expect(onSentenceClick).not.toHaveBeenCalled();
  });

  test('auto-scrolls to the active sentence when it changes', () => {
    const { rerender } = render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
    window.Element.prototype.scrollIntoView.mockClear();

    rerender(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('suspends auto-scroll after a manual scroll, instead of fighting the reader', async () => {
    const { rerender } = render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    // Let the mount's own programmatic scrollIntoView finish clearing its
    // "was that us?" flag before firing a scroll that must read as manual.
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.scroll(screen.getByRole('log', { name: /book text/i }));
    window.Element.prototype.scrollIntoView.mockClear();

    rerender(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('sentence-0-1')).toBeInTheDocument());
    expect(window.Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
