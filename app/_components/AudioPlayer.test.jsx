import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import AudioPlayer from './AudioPlayer';

const chunks = ['第一段。', '第二段。', '第三段。', '第四段。'];

describe('AudioPlayer', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('fetches a look-ahead buffer, plays chunks in order, and supports play/pause', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} />
      </ChakraProvider>,
    );

    // Look-ahead window (current + 2) is requested up front, not the whole book.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).chunkIndex)).toEqual([
      0, 1, 2,
    ]);

    expect(screen.getByText('Chunk 1 of 4')).toBeInTheDocument();

    const playButton = await screen.findByRole('button', { name: /play/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();

    const audioEl = screen.getByTestId('audio-element');
    expect(audioEl.src).toBe('https://blob.test/0');

    // Finishing chunk 0 advances to chunk 1 and tops up the look-ahead buffer (chunk 3).
    fireEvent.ended(audioEl);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    expect(JSON.parse(global.fetch.mock.calls[3][1].body).chunkIndex).toBe(3);
    expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument();
    await waitFor(() => expect(audioEl.src).toBe('https://blob.test/1'));

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
  });

  test('stops signalling as playing if the chunk lined up next already failed to generate', async () => {
    const twoChunks = ['第一段。', '第二段。'];
    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      if (chunkIndex === 1) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 502 });
      }
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-err" chunks={twoChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /play/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    // Chunk 1 (fetched ahead of time) came back as an error, not ready - rather
    // than silently stalling with Pause still showing, playback stops signalling
    // as active and a visible error + retry control take over (ticket 08).
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't generate audio/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('resumes at a given initialIndex without requesting earlier chunks', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resume" chunks={chunks} initialIndex={2} />
      </ChakraProvider>,
    );

    expect(screen.getByText('Chunk 3 of 4')).toBeInTheDocument();

    // Look-ahead from index 2 (current + 2) covers chunks 2 and 3 only - chunks
    // 0 and 1 were already heard in an earlier session and are never requested.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).chunkIndex)).toEqual([
      2, 3,
    ]);
  });

  test('surfaces a visible error and lets the reader manually retry the current chunk', async () => {
    let chunk0Attempts = 0;
    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      if (chunkIndex === 0) {
        chunk0Attempts += 1;
        if (chunk0Attempts === 1) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 502 });
        }
      }
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-retry" chunks={chunks} />
      </ChakraProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't generate audio/i);
    const retryButton = screen.getByRole('button', { name: /retry/i });
    // No misleading disabled "Play" button alongside the error.
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument();

    fireEvent.click(retryButton);

    await waitFor(() => expect(chunk0Attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeEnabled();
  });

  test('a failed look-ahead chunk does not block unrelated cached chunks, and retrying it resumes playback without losing position', async () => {
    const threeChunks = ['第一段。', '第二段。', '第三段。'];
    let chunk1Attempts = 0;
    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      if (chunkIndex === 1) {
        chunk1Attempts += 1;
        if (chunk1Attempts === 1) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 502 });
        }
      }
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-retry-2" chunks={threeChunks} />
      </ChakraProvider>,
    );

    // Chunk 2, unrelated to the chunk-1 failure, still generated in the background.
    await waitFor(() => expect(chunk1Attempts).toBe(1));
    expect(global.fetch.mock.calls.some(([, init]) => JSON.parse(init.body).chunkIndex === 2)).toBe(
      true,
    );

    const playButton = await screen.findByRole('button', { name: /play/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    // Advanced to the errored chunk 1 - position moves forward, error surfaces.
    expect(screen.getByText('Chunk 2 of 3')).toBeInTheDocument();
    const retryButton = await screen.findByRole('button', { name: /retry/i });

    fireEvent.click(retryButton);

    await waitFor(() => expect(chunk1Attempts).toBe(2));
    // Retry succeeded and playback resumed on its own - the reader was already
    // mid-playback, so a successful retry shouldn't require a second Play click.
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Chunk 2 of 3')).toBeInTheDocument();
  });

  test('calls onBackToLibrary when the reader asks to switch books', async () => {
    const onBackToLibrary = vi.fn();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} onBackToLibrary={onBackToLibrary} />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByText(/back to library/i));

    expect(onBackToLibrary).toHaveBeenCalledTimes(1);
  });
});

describe('AudioPlayer sentence highlighting, auto-scroll, and jump-to-sentence seeking', () => {
  const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];
  const boundariesByChunk = {
    0: [
      { text: '第一句', offset: 0, duration: 10_000_000 },
      { text: '第二句', offset: 10_000_000, duration: 10_000_000 },
    ],
    1: [
      { text: '第三句', offset: 0, duration: 10_000_000 },
      { text: '第四句', offset: 10_000_000, duration: 10_000_000 },
    ],
  };

  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({
          url: `https://blob.test/${chunkIndex}`,
          boundaries: boundariesByChunk[chunkIndex] ?? [],
        }),
        { status: 200 },
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('highlights the sentence containing the current playback time and auto-scrolls to it', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-hl" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const playButton = await screen.findByRole('button', { name: /play/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    await waitFor(() =>
      expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByTestId('sentence-0-0')).not.toHaveAttribute('data-active');
    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  test('suspends auto-scroll after a manual scroll, instead of fighting the reader', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-hl-scroll" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const playButton = await screen.findByRole('button', { name: /play/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    fireEvent.scroll(screen.getByRole('log', { name: /book text/i }));
    window.Element.prototype.scrollIntoView.mockClear();

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    await waitFor(() =>
      expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true'),
    );
    expect(window.Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  test('clicking a sentence in the currently loaded chunk seeks audio.currentTime there', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-seek" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^play$/i })).toBeEnabled());

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  test('clicking a sentence in a not-yet-generated chunk generates only that chunk - not the ones skipped over - then seeks there once ready', async () => {
    const eightChunks = [
      '第一段。',
      '第二段。',
      '第三段。',
      '第四段。',
      '第五段。',
      '第六段。',
      '第七段之一。第七段之二。',
      '第八段。',
    ];
    global.fetch = vi.fn(async (_url, { body }) => {
      const { chunkIndex } = JSON.parse(body);
      const boundaries =
        chunkIndex === 6
          ? [
              { text: '第七段之一', offset: 0, duration: 10_000_000 },
              { text: '第七段之二', offset: 10_000_000, duration: 10_000_000 },
            ]
          : [];
      return new Response(JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries }), {
        status: 200,
      });
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-jump" chunks={eightChunks} />
      </ChakraProvider>,
    );

    // Initial look-ahead from chunk 0 covers chunks 0-2 only.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByTestId('sentence-6-1'));

    await waitFor(() => expect(screen.getByText('Chunk 7 of 8')).toBeInTheDocument());

    const requestedChunkIndexes = () =>
      global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).chunkIndex);
    await waitFor(() => expect(requestedChunkIndexes()).toContain(6));
    expect(requestedChunkIndexes().filter((index) => index === 6)).toHaveLength(1);
    // Chunks 3, 4, and 5 sat between the initial look-ahead and the jump target - jumping
    // ahead must not force generating any of them.
    expect(requestedChunkIndexes()).not.toEqual(expect.arrayContaining([3, 4, 5]));

    const audioEl = screen.getByTestId('audio-element');
    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(await screen.findByTestId('sentence-6-1')).toHaveAttribute('data-active', 'true');
  });
});
