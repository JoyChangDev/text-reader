import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import AudioPlayer from './AudioPlayer';

const chunks = ['第一段。', '第二段。', '第三段。', '第四段。'];

describe('AudioPlayer', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();

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
