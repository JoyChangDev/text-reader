import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  fireEvent.mouseUp(screen.getByRole('log', { name: /book text/i }));
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

  test('the "jump to now playing" button scrolls to the active sentence, reusing the same auto-scroll behavior', async () => {
    render(
      <ChakraProvider>
        <TranscriptView
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

    fireEvent.click(screen.getByRole('button', { name: /jump to now playing/i }));

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('the "jump to now playing" button scrolls even while auto-scroll is suspended from a recent manual scroll', async () => {
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={1}
          activeSentenceIndex={1}
          onSentenceClick={() => {}}
        />
      </ChakraProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.scroll(screen.getByRole('log', { name: /book text/i }));
    window.Element.prototype.scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /jump to now playing/i }));

    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("reports scroll position as a percentage derived purely from the transcript container's own scroll geometry", () => {
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

    const container = screen.getByRole('log', { name: /book text/i });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 250;

    fireEvent.scroll(container);

    expect(screen.getByRole('slider', { name: /text position/i })).toHaveValue('50');
  });

  test('reports 0% when the container has no scrollable range, rather than dividing by zero', () => {
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

    const container = screen.getByRole('log', { name: /book text/i });
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 0;

    fireEvent.scroll(container);

    expect(screen.getByRole('slider', { name: /text position/i })).toHaveValue('0');
  });

  test('dragging the indicator scrolls the transcript to the target percentage, without touching sentence seeking', () => {
    const onSentenceClick = vi.fn();
    render(
      <ChakraProvider>
        <TranscriptView
          chunks={twoSentenceChunks}
          currentIndex={0}
          activeSentenceIndex={0}
          onSentenceClick={onSentenceClick}
        />
      </ChakraProvider>,
    );

    const container = screen.getByRole('log', { name: /book text/i });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });

    fireEvent.change(screen.getByRole('slider', { name: /text position/i }), {
      target: { value: '40' },
    });

    expect(container.scrollTop).toBe(200);
    expect(onSentenceClick).not.toHaveBeenCalled();
  });

  test('clicking "jump to now playing" re-arms auto-scroll, so the next sentence change follows immediately instead of staying suspended', async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.scroll(screen.getByRole('log', { name: /book text/i }));
    fireEvent.click(screen.getByRole('button', { name: /jump to now playing/i }));
    window.Element.prototype.scrollIntoView.mockClear();

    // Without the button's click having re-armed auto-scroll, this next sentence change
    // would still read as suspended (the manual scroll's 4s idle window hasn't elapsed).
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
    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  describe('reporting a pronunciation issue', () => {
    test('does not show the report affordance before any text is selected', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      expect(
        screen.queryByRole('button', { name: /report pronunciation issue/i }),
      ).not.toBeInTheDocument();
    });

    test('selecting text surfaces the report affordance', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('第一句');

      expect(
        screen.getByRole('button', { name: /report pronunciation issue/i }),
      ).toBeInTheDocument();
    });

    test('a collapsed (empty) selection does not surface the affordance', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('');

      expect(
        screen.queryByRole('button', { name: /report pronunciation issue/i }),
      ).not.toBeInTheDocument();
    });

    test('opening the form pre-fills the selected phrase and the book title', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      fireEvent.click(screen.getByRole('button', { name: /report pronunciation issue/i }));

      expect(screen.getByText('第一句')).toBeInTheDocument();
      expect(screen.getByText('First Book')).toBeInTheDocument();
    });

    test('submitting the form reports the issue and gives visible confirmation', async () => {
      submitReport.mockResolvedValueOnce({
        bookTitle: 'First Book',
        phrase: '第一句',
        description: 'sounds off',
        reportedAt: '2026-07-30T12:00:00.000Z',
      });

      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      fireEvent.click(screen.getByRole('button', { name: /report pronunciation issue/i }));
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'sounds off' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

      expect(submitReport).toHaveBeenCalledWith({
        bookTitle: 'First Book',
        phrase: '第一句',
        description: 'sounds off',
      });
      expect(await screen.findByRole('status')).toHaveTextContent(/thanks/i);
    });

    test('shows an error and re-enables the form when submitting the report fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      submitReport.mockRejectedValueOnce(new Error('Submitting the pronunciation report failed'));

      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      fireEvent.click(screen.getByRole('button', { name: /report pronunciation issue/i }));
      fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t submit/i);
      expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    test('selecting a new phrase replaces a previous report in progress', () => {
      render(
        <ChakraProvider>
          <TranscriptView
            chunks={twoSentenceChunks}
            currentIndex={0}
            activeSentenceIndex={0}
            onSentenceClick={() => {}}
            bookTitle="First Book"
          />
        </ChakraProvider>,
      );

      selectText('第一句');
      fireEvent.click(screen.getByRole('button', { name: /report pronunciation issue/i }));
      expect(screen.getByText('第一句')).toBeInTheDocument();

      selectText('第三句');

      expect(
        screen.getByRole('button', { name: /report pronunciation issue/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText('第一句')).not.toBeInTheDocument();
    });
  });
});
