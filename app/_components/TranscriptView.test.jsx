import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { submitReport } from '@/app/_lib/pronunciationReports';

import ChakraProvider from '../_providers/chakra';
import TranscriptView from './TranscriptView';

vi.mock('@/app/_lib/pronunciationReports', () => ({
  submitReport: vi.fn(),
}));

const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];

function selectText(text) {
  window.getSelection = vi.fn(() => ({ toString: () => text }));
  fireEvent.mouseUp(screen.getByRole('log', { name: /書籍內文/i }));
}

describe('TranscriptView', () => {
  beforeEach(() => {
    window.Element.prototype.scrollIntoView = vi.fn();
    submitReport.mockReset();
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

  test('auto-scrolls to the active sentence when it changes, immediately rather than smoothly', () => {
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

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
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

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });

  test("hides the transcript scroll container's native scrollbar while keeping it scrollable", () => {
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    const container = screen.getByRole('log', { name: /書籍內文/i });
    expect(container).toHaveStyle({ overflowY: 'auto' });
    expect(getComputedStyle(container).scrollbarWidth).toBe('none');
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

    fireEvent.scroll(screen.getByRole('log', { name: /書籍內文/i }));
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

  // The scroll-position indicator and "jump to now playing" control both moved into
  // PlayerBar (a sibling, wired up by AudioPlayer) - see TranscriptView's own doc
  // comment. What used to be UI interactions here are now calls through the ref this
  // component exposes (write direction) and assertions on onScrollPercentChange (read
  // direction), but the underlying behavior guarantees are unchanged.

  test('ref.jumpToNowPlaying() scrolls to the active sentence, reusing the same auto-scroll behavior', async () => {
    const ref = createRef();
    render(
      <ChakraProvider>
        <TranscriptView
          ref={ref}
          chunks={twoSentenceChunks}
          currentIndex={1}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    // Let the mount's own auto-scroll settle first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.Element.prototype.scrollIntoView.mockClear();

    ref.current.jumpToNowPlaying();

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('ref.jumpToNowPlaying() scrolls even while auto-scroll is suspended from a recent manual scroll', async () => {
    const ref = createRef();
    render(
      <ChakraProvider>
        <TranscriptView
          ref={ref}
          chunks={twoSentenceChunks}
          currentIndex={1}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.scroll(screen.getByRole('log', { name: /書籍內文/i }));
    window.Element.prototype.scrollIntoView.mockClear();

    ref.current.jumpToNowPlaying();

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("reports scroll position as a percentage derived purely from the transcript container's own scroll geometry", () => {
    const onScrollPercentChange = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
          onScrollPercentChange={onScrollPercentChange}
        />
      </ChakraProvider>,
    );
    onScrollPercentChange.mockClear();

    const container = screen.getByRole('log', { name: /書籍內文/i });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 250;

    fireEvent.scroll(container);

    expect(onScrollPercentChange).toHaveBeenCalledWith(50);
  });

  test('reports 0% when the container has no scrollable range, rather than dividing by zero', () => {
    const onScrollPercentChange = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
          onScrollPercentChange={onScrollPercentChange}
        />
      </ChakraProvider>,
    );
    onScrollPercentChange.mockClear();

    const container = screen.getByRole('log', { name: /書籍內文/i });
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 0;

    fireEvent.scroll(container);

    expect(onScrollPercentChange).toHaveBeenCalledWith(0);
  });

  test('ref.seekToScrollPercent() scrolls the transcript to the target percentage, without touching sentence seeking', () => {
    const ref = createRef();
    const onSentenceClick = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          ref={ref}
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={onSentenceClick}
        />
      </ChakraProvider>,
    );

    const container = screen.getByRole('log', { name: /書籍內文/i });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });

    ref.current.seekToScrollPercent(40);

    expect(container.scrollTop).toBe(200);
    expect(onSentenceClick).not.toHaveBeenCalled();
  });

  test('calling ref.jumpToNowPlaying() re-arms auto-scroll, so the next sentence change follows immediately instead of staying suspended', async () => {
    const ref = createRef();
    const { rerender } = render(
      <ChakraProvider>
        <TranscriptView
          ref={ref}
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.scroll(screen.getByRole('log', { name: /書籍內文/i }));
    ref.current.jumpToNowPlaying();
    window.Element.prototype.scrollIntoView.mockClear();

    // Without jumpToNowPlaying() having re-armed auto-scroll, this next sentence change
    // would still read as suspended (the manual scroll's 4s idle window hasn't elapsed).
    rerender(
      <ChakraProvider>
        <TranscriptView
          ref={ref}
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('sentence-0-1')).toBeInTheDocument());
    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  describe('report mode', () => {
    test('a text selection made outside of report mode never surfaces the report form', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode={false}
          />
        </ChakraProvider>,
      );

      selectText('第一句');

      expect(screen.queryByTestId('pronunciation-report-modal')).not.toBeInTheDocument();
    });

    test('a non-empty selection made while report mode is active surfaces the report form', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode
          />
        </ChakraProvider>,
      );

      selectText('第一句');

      expect(screen.getByTestId('pronunciation-report-modal')).toBeInTheDocument();
      expect(screen.getByText('第一句')).toBeInTheDocument();
      expect(screen.getByText('First Book')).toBeInTheDocument();
    });

    test('a collapsed (empty) selection does not surface the form, even in report mode', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode
          />
        </ChakraProvider>,
      );

      selectText('');

      expect(screen.queryByTestId('pronunciation-report-modal')).not.toBeInTheDocument();
    });

    test('leaving report mode (prop flips to false) closes any open form', () => {
      const { rerender } = render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      expect(screen.getByTestId('pronunciation-report-modal')).toBeInTheDocument();

      rerender(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode={false}
          />
        </ChakraProvider>,
      );

      expect(screen.queryByTestId('pronunciation-report-modal')).not.toBeInTheDocument();
    });

    test('dismissing the form calls onExitReportMode, restoring ordinary Sentence-click seeking', () => {
      const onExitReportMode = vi.fn();
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
            reportMode
            onExitReportMode={onExitReportMode}
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      fireEvent.click(screen.getByRole('button', { name: /取消/ }));

      expect(onExitReportMode).toHaveBeenCalledTimes(1);
    });

    test('Sentence-click seeking is blocked while report mode is active, independent of isPlaying', () => {
      const onSentenceClick = vi.fn();
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            isPlaying={false}
            onSentenceClick={onSentenceClick}
            reportMode
          />
        </ChakraProvider>,
      );

      fireEvent.click(screen.getByTestId('sentence-1-0'));

      expect(onSentenceClick).not.toHaveBeenCalled();
    });
  });
});
