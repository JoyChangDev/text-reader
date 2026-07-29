import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getListenerSettings } from '@/app/_lib/listenerSettings';

import ChakraProvider from '../_providers/chakra';
import AudioPlayer from './AudioPlayer';

const chunks = ['第一段。', '第二段。', '第三段。', '第四段。'];

// useBookPlayer.js also persists the resume index to /api/library/[bookId] on every
// chunk change (see ticket 07) - these helpers isolate the /api/audio-chunks traffic
// these tests actually care about from that unrelated background traffic, which would
// otherwise throw off call counts/indices below.
function mockAudioChunkFetch(handleAudioChunk) {
  global.fetch = vi.fn(async (url, init) => {
    if (url !== '/api/audio-chunks') {
      return new Response('{}', { status: 200 });
    }
    return handleAudioChunk(init);
  });
}

function audioChunkFetchCalls() {
  return global.fetch.mock.calls.filter(([url]) => url === '/api/audio-chunks');
}

function libraryPatchCalls() {
  return global.fetch.mock.calls.filter(
    ([url, init]) => url.startsWith('/api/library/') && init?.method === 'PATCH',
  );
}

describe('AudioPlayer', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(({ body }) => {
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
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    expect(audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex)).toEqual([
      0, 1, 2,
    ]);

    expect(screen.getByText('Chunk 1 of 4')).toBeInTheDocument();

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();

    const audioEl = screen.getByTestId('audio-element');
    expect(audioEl.src).toBe('https://blob.test/0');

    // Chunk 1's audio was already buffered into the standby element ahead of time
    // (see ticket 05) - finishing chunk 0 swaps to it directly instead of assigning a
    // fresh, cold src.
    const standbyEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(standbyEl.src).toBe('https://blob.test/1'));

    // Finishing chunk 0 advances to chunk 1 and tops up the look-ahead buffer (chunk 3).
    fireEvent.ended(audioEl);

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    expect(JSON.parse(audioChunkFetchCalls()[3][1].body).chunkIndex).toBe(3);
    expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument();
    // Still the same src it was preloaded with - no fresh load happened at swap time.
    expect(standbyEl.src).toBe('https://blob.test/1');
    expect(standbyEl).toHaveAttribute('data-active', 'true');

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
  });

  test('stops signalling as playing if the chunk lined up next already failed to generate', async () => {
    const twoChunks = ['第一段。', '第二段。'];
    mockAudioChunkFetch(({ body }) => {
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

    const playButton = await screen.findByRole('button', { name: /^play$/i });
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
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    expect(audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex)).toEqual([
      2, 3,
    ]);
  });

  test('surfaces a visible error and lets the reader manually retry the current chunk', async () => {
    let chunk0Attempts = 0;
    mockAudioChunkFetch(({ body }) => {
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
    mockAudioChunkFetch(({ body }) => {
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
    expect(audioChunkFetchCalls().some(([, init]) => JSON.parse(init.body).chunkIndex === 2)).toBe(
      true,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
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

describe('AudioPlayer voice selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(({ body }) => {
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

  test('defaults to the current hardcoded voice and sends it with each chunk request', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} />
      </ChakraProvider>,
    );

    const picker = screen.getByLabelText(/narration voice/i);
    expect(picker).toHaveValue('zh-TW-HsiaoChenNeural');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.value),
    ).toEqual(['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural']);
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    expect(JSON.parse(audioChunkFetchCalls()[0][1].body).voice).toBe('zh-TW-HsiaoChenNeural');
  });

  test('changing the voice persists it and applies to subsequently fetched chunks only', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));

    fireEvent.change(screen.getByLabelText(/narration voice/i), {
      target: { value: 'zh-TW-YunJheNeural' },
    });

    expect(getListenerSettings().voice).toBe('zh-TW-YunJheNeural');

    // Chunk 3 finishes playing chunk 0 and is topped up next - it's the first
    // request made after the voice change, so it's the first to use it.
    const audioEl = screen.getByTestId('audio-element');
    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });
    fireEvent.ended(audioEl);

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    const lastCallBody = JSON.parse(audioChunkFetchCalls()[3][1].body);
    expect(lastCallBody).toMatchObject({ chunkIndex: 3, voice: 'zh-TW-YunJheNeural' });
  });
});

describe('AudioPlayer playback speed', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(({ body }) => {
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

  test('defaults to 1x and offers the fixed presets', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-speed" chunks={chunks} />
      </ChakraProvider>,
    );

    const picker = screen.getByLabelText(/playback speed/i);
    expect(picker).toHaveValue('1');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.value),
    ).toEqual(['0.75', '1', '1.25', '1.5', '1.75', '2']);
  });

  test('selecting a speed applies it immediately to the currently loaded audio and persists it', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-speed-2" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.change(screen.getByLabelText(/playback speed/i), { target: { value: '1.5' } });

    expect(audioEl.playbackRate).toBe(1.5);
    expect(getListenerSettings().speed).toBe(1.5);
  });

  test('a selected speed carries over to the next chunk loaded within the same session', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-speed-3" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    fireEvent.change(screen.getByLabelText(/playback speed/i), { target: { value: '2' } });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    await waitFor(() => expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument());
    // Chunk 1 swapped onto the standby element (see ticket 05) - it's the one actually
    // playing now, so it's the one that must carry the selected speed.
    const activeEl = screen.getByTestId('audio-element-standby');
    expect(activeEl).toHaveAttribute('data-active', 'true');
    await waitFor(() => expect(activeEl.playbackRate).toBe(2));
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

    mockAudioChunkFetch(({ body }) => {
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

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    const playButton = await screen.findByRole('button', { name: /^play$/i });
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

  // Auto-scroll suspension on manual scroll is TranscriptView's own behavior,
  // unit-tested in isolation there (see ticket 07) - not re-asserted here.

  test('clicking a sentence while paused highlights it and queues it without starting playback; pressing play then seeks and plays from there', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-seek" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^play$/i })).toBeEnabled());

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Selecting a sentence while paused only queues it (see ticket 02) - the highlight
    // updates immediately, but nothing plays until Play is pressed.
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(audioEl.currentTime).toBe(0);
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  test('clicking a sentence in a not-yet-generated chunk generates only that chunk - not the ones skipped over - then seeks there once play is pressed', async () => {
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
    mockAudioChunkFetch(({ body }) => {
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
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));

    fireEvent.click(screen.getByTestId('sentence-6-1'));

    await waitFor(() => expect(screen.getByText('Chunk 7 of 8')).toBeInTheDocument());

    const requestedChunkIndexes = () =>
      audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex);
    await waitFor(() => expect(requestedChunkIndexes()).toContain(6));
    expect(requestedChunkIndexes().filter((index) => index === 6)).toHaveLength(1);
    // Chunks 3, 4, and 5 sat between the initial look-ahead and the jump target - jumping
    // ahead must not force generating any of them.
    expect(requestedChunkIndexes()).not.toEqual(expect.arrayContaining([3, 4, 5]));

    // The highlight is already queued on the selected sentence, but nothing has played
    // yet - clicking a sentence only sets up where the next play will start (ticket 02).
    expect(screen.getByTestId('sentence-6-1')).toHaveAttribute('data-active', 'true');
    const audioEl = screen.getByTestId('audio-element');
    expect(audioEl.currentTime).toBe(0);

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    await waitFor(() => expect(playButton).toBeEnabled());
    fireEvent.click(playButton);

    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(await screen.findByTestId('sentence-6-1')).toHaveAttribute('data-active', 'true');
  });
});

describe('AudioPlayer playback lock', () => {
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

    mockAudioChunkFetch(({ body }) => {
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

  test('disables the voice and speed pickers while playing, and re-enables them on pause', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-lock" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    expect(screen.getByLabelText(/narration voice/i)).toBeEnabled();
    expect(screen.getByLabelText(/playback speed/i)).toBeEnabled();

    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    expect(screen.getByLabelText(/narration voice/i)).toBeDisabled();
    expect(screen.getByLabelText(/playback speed/i)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    expect(await screen.findByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/narration voice/i)).toBeEnabled();
    expect(screen.getByLabelText(/playback speed/i)).toBeEnabled();
  });

  test('clicking a sentence while playing has no effect', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-lock-2" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const audioEl = screen.getByTestId('audio-element');
    expect(screen.getByTestId('sentence-0-0')).toHaveAttribute('data-active', 'true');

    fireEvent.click(screen.getByTestId('sentence-1-1'));

    // No highlight change, no seek, no chunk jump - the accidental tap is a no-op
    // while playing (see ticket 02).
    expect(screen.getByTestId('sentence-0-0')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sentence-1-1')).not.toHaveAttribute('data-active');
    expect(audioEl.currentTime).toBe(0);
    expect(screen.getByText('Chunk 1 of 2')).toBeInTheDocument();
  });

  test('clicking a different sentence in the already-loaded chunk while paused seeks immediately, without resuming playback', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-lock-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    await screen.findByRole('button', { name: /^play$/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // The chunk was already loaded (it had started playing before the pause), so the
    // seek applies to audio.currentTime immediately - but it still doesn't resume
    // playback on its own (see ticket 02, the alreadyLoaded branch of seekToSentence).
    expect(audioEl.currentTime).toBe(1);
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));

    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
    expect(audioEl.currentTime).toBe(1);
  });
});

describe('AudioPlayer chunk-to-chunk audio preloading', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("buffers the next chunk's actual audio into the standby element as soon as it's ready, ahead of the current chunk ending", async () => {
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-preload-1" chunks={chunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    // Buffered into the standby element while chunk 0 is still playing - not yet the
    // active one.
    const standbyEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(standbyEl.src).toBe('https://blob.test/1'));
    expect(standbyEl).not.toHaveAttribute('data-active');
  });

  test('advances to an already-buffered standby element without a fresh src assignment, then starts preloading the chunk after that', async () => {
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-preload-2" chunks={chunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const primaryEl = screen.getByTestId('audio-element');
    const standbyEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(standbyEl.src).toBe('https://blob.test/1'));
    const preloadedSrc = standbyEl.src;

    fireEvent.ended(primaryEl);

    await waitFor(() => expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument());
    // Still exactly the src it was preloaded with - proves no fresh load happened at
    // the moment of the swap.
    expect(standbyEl.src).toBe(preloadedSrc);
    expect(standbyEl).toHaveAttribute('data-active', 'true');
    expect(primaryEl).not.toHaveAttribute('data-active');
    // The now-standby element (previously active) starts buffering chunk 2 in turn.
    await waitFor(() => expect(primaryEl.src).toBe('https://blob.test/2'));
  });

  test("falls back to a cold load on the newly-current chunk when its audio wasn't buffered in time, preserving existing chunk-advancement behavior", async () => {
    const resolvers = {};
    mockAudioChunkFetch(
      ({ body }) =>
        new Promise((resolve) => {
          const { chunkIndex } = JSON.parse(body);
          resolvers[chunkIndex] = resolve;
        }),
    );

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-preload-3" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    resolvers[0](
      new Response(JSON.stringify({ url: 'https://blob.test/0', boundaries: [] }), {
        status: 200,
      }),
    );

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });

    const primaryEl = screen.getByTestId('audio-element');
    const standbyEl = screen.getByTestId('audio-element-standby');
    // Chunk 1's request is still in flight - nothing buffered into standby yet.
    expect(standbyEl).not.toHaveAttribute('src');

    fireEvent.ended(primaryEl);

    // No swap happened (nothing was buffered) - the primary element stays "active".
    expect(primaryEl).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('Chunk 2 of 4')).toBeInTheDocument();

    resolvers[1](
      new Response(JSON.stringify({ url: 'https://blob.test/1', boundaries: [] }), {
        status: 200,
      }),
    );

    // Falls back to the normal cold-load path, unchanged from before this ticket, once
    // chunk 1's audio finally becomes ready.
    await waitFor(() => expect(primaryEl.src).toBe('https://blob.test/1'));
  });
});

describe('AudioPlayer resume-index persistence', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(({ body }) => {
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

  test('persists the current chunk index to the library as the book advances', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-persist'),
    );
    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({ resumeIndex: 0 });

    const playButton = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /pause/i });
    fireEvent.ended(screen.getByTestId('audio-element'));

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({ resumeIndex: 1 }),
    );
  });
});
