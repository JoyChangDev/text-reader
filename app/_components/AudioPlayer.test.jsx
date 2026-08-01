import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getDiagnosticLog } from '@/app/_lib/backgroundDiagnostics';
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

// Shared by the background/foreground resync and background-flush describe blocks below
// (see Phase 1.8 tickets 01 and 03) - both simulate an app switch by driving
// document.visibilityState directly, since jsdom doesn't do this on its own.
function setVisibilityState(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// Voice and speed pickers live behind PlayerBar's Settings disclosure (see
// PlayerSettingsSheet) - these tests exercise them through AudioPlayer end to end, so
// they need opening first.
function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: /^設定$/i }));
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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();

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
    // Still the same src it was preloaded with - no fresh load happened at swap time.
    expect(standbyEl.src).toBe('https://blob.test/1');
    expect(standbyEl).toHaveAttribute('data-active', 'true');

    const pauseButton = screen.getByRole('button', { name: /暫停/i });
    fireEvent.click(pauseButton);

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    // Chunk 1 (fetched ahead of time) came back as an error, not ready - rather
    // than silently stalling with Pause still showing, playback stops signalling
    // as active and a visible error + retry control take over (ticket 08).
    expect(await screen.findByRole('alert')).toHaveTextContent(/語音產生失敗/i);
    expect(screen.getByRole('button', { name: /重試/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^播放$/i })).not.toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('resumes at a given initialIndex without requesting earlier chunks', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resume" chunks={chunks} initialIndex={2} />
      </ChakraProvider>,
    );

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

    expect(await screen.findByRole('alert')).toHaveTextContent(/語音產生失敗/i);
    const retryButton = screen.getByRole('button', { name: /重試/i });
    // No misleading disabled "Play" button alongside the error.
    expect(screen.queryByRole('button', { name: /^播放$/i })).not.toBeInTheDocument();

    fireEvent.click(retryButton);

    await waitFor(() => expect(chunk0Attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeEnabled();
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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    // Advanced to the errored chunk 1 - position moves forward, error surfaces.
    const retryButton = await screen.findByRole('button', { name: /重試/i });

    fireEvent.click(retryButton);

    await waitFor(() => expect(chunk1Attempts).toBe(2));
    // Retry succeeded and playback resumed on its own - the reader was already
    // mid-playback, so a successful retry shouldn't require a second Play click.
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('calls onBackToLibrary when the reader asks to switch books', async () => {
    const onBackToLibrary = vi.fn();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} onBackToLibrary={onBackToLibrary} />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByText(/返回書庫/i));

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
    openSettings();

    const group = screen.getByRole('radiogroup', { name: /朗讀聲音/i });
    expect(within(group).getByRole('radio', { name: 'Hsiao-Chen' })).toBeChecked();
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.value),
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
    openSettings();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
        name: 'Yun-Jhe',
      }),
    );

    expect(getListenerSettings().voice).toBe('zh-TW-YunJheNeural');

    // Chunk 3 finishes playing chunk 0 and is topped up next - it's the first
    // request made after the voice change, so it's the first to use it.
    const audioEl = screen.getByTestId('audio-element');
    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
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
    openSettings();

    const group = screen.getByRole('radiogroup', { name: /播放速度/i });
    expect(within(group).getByRole('radio', { name: '1x' })).toBeChecked();
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.value),
    ).toEqual(['0.75', '1', '1.25', '1.5', '1.75', '2']);
  });

  test('selecting a speed applies it immediately to the currently loaded audio and persists it', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-speed-2" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(3));
    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    openSettings();

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /播放速度/i })).getByRole('radio', {
        name: '1.5x',
      }),
    );

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
    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    openSettings();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /播放速度/i })).getByRole('radio', {
        name: '2x',
      }),
    );

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.ended(audioEl);

    // Chunk 1 swapped onto the standby element (see ticket 05) - it's the one actually
    // playing now, so it's the one that must carry the selected speed.
    const activeEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(activeEl).toHaveAttribute('data-active', 'true'));
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
    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

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
    await waitFor(() => expect(screen.getByRole('button', { name: /^播放$/i })).toBeEnabled());

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Selecting a sentence while paused only queues it (see ticket 02) - the highlight
    // updates immediately, but nothing plays until Play is pressed.
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(audioEl.currentTime).toBe(0);
    expect(screen.getByRole('button', { name: /^播放$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^播放$/i }));

    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
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

    await waitFor(() =>
      expect(screen.getByTestId('sentence-6-1')).toHaveAttribute('data-active', 'true'),
    );

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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
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

    const expectPickersEnabled = () => {
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i }))
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeEnabled());
      within(screen.getByRole('radiogroup', { name: /播放速度/i }))
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeEnabled());
    };
    const expectPickersDisabled = () => {
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i }))
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeDisabled());
      within(screen.getByRole('radiogroup', { name: /播放速度/i }))
        .getAllByRole('radio')
        .forEach((radio) => expect(radio).toBeDisabled());
    };

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    openSettings();
    expectPickersEnabled();

    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    expectPickersDisabled();

    fireEvent.click(screen.getByRole('button', { name: /暫停/i }));

    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
    expectPickersEnabled();
  });

  test('clicking a sentence while playing has no effect', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-lock-2" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    expect(screen.getByTestId('sentence-0-0')).toHaveAttribute('data-active', 'true');

    fireEvent.click(screen.getByTestId('sentence-1-1'));

    // No highlight change, no seek, no chunk jump - the accidental tap is a no-op
    // while playing (see ticket 02).
    expect(screen.getByTestId('sentence-0-0')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sentence-1-1')).not.toHaveAttribute('data-active');
    expect(audioEl.currentTime).toBe(0);
  });

  test('clicking a different sentence in the already-loaded chunk while paused seeks immediately, without resuming playback', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-lock-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    fireEvent.click(screen.getByRole('button', { name: /暫停/i }));
    await screen.findByRole('button', { name: /^播放$/i });

    const audioEl = screen.getByTestId('audio-element');
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // The chunk was already loaded (it had started playing before the pause), so the
    // seek applies to audio.currentTime immediately - but it still doesn't resume
    // playback on its own (see ticket 02, the alreadyLoaded branch of seekToSentence).
    expect(audioEl.currentTime).toBe(1);
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^播放$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^播放$/i }));

    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const primaryEl = screen.getByTestId('audio-element');
    const standbyEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(standbyEl.src).toBe('https://blob.test/1'));
    const preloadedSrc = standbyEl.src;

    fireEvent.ended(primaryEl);

    await waitFor(() => expect(standbyEl).toHaveAttribute('data-active', 'true'));
    // Still exactly the src it was preloaded with - proves no fresh load happened at
    // the moment of the swap.
    expect(standbyEl.src).toBe(preloadedSrc);
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

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const primaryEl = screen.getByTestId('audio-element');
    const standbyEl = screen.getByTestId('audio-element-standby');
    // Chunk 1's request is still in flight - nothing buffered into standby yet.
    expect(standbyEl).not.toHaveAttribute('src');

    fireEvent.ended(primaryEl);

    // No swap happened (nothing was buffered) - the primary element stays "active".
    expect(primaryEl).toHaveAttribute('data-active', 'true');
    // Advancing to chunk 1 tops up the look-ahead buffer with chunk 3, proving the
    // position moved forward even without a standby swap.
    await waitFor(() =>
      expect(audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex)).toContain(
        3,
      ),
    );

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

  test('persists the current chunk and sentence index together to the library as the book advances', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-persist'),
    );
    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 0,
      resumeSentenceIndex: 0,
    });

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    fireEvent.ended(screen.getByTestId('audio-element'));

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 1,
        resumeSentenceIndex: 0,
      }),
    );
  });

  test('an explicit Sentence click persists the new reading position immediately', async () => {
    const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist-click" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 1,
      }),
    );
  });

  test('natural playback advancing the active Sentence persists the new Sentence position', async () => {
    const boundaries = [
      { text: '第一句', offset: 0, duration: 10_000_000 },
      { text: '第二句', offset: 10_000_000, duration: 10_000_000 },
    ];
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries }), {
        status: 200,
      });
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist-tick" chunks={['第一句。第二句。']} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 1,
      }),
    );
  });

  test('scrolling the transcript and dragging the position slider never persist a reading position', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist-scroll" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-persist-scroll'),
    );
    const patchCallCountAfterMount = libraryPatchCalls().length;

    const container = screen.getByRole('log', { name: /書籍內文/i });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    container.scrollTop = 250;
    fireEvent.scroll(container);

    fireEvent.change(screen.getByRole('slider', { name: /文字位置/i }), {
      target: { value: '65' },
    });

    // Give any debounced persistence effect a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(libraryPatchCalls()).toHaveLength(patchCallCountAfterMount);
  });
});

describe('AudioPlayer resume-to-saved-sentence without autoplay', () => {
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

  test('opening a Book with a saved (resumeIndex, resumeSentenceIndex) renders at that Sentence without audio playing', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer
          bookId="book-resume-sentence"
          chunks={twoSentenceChunks}
          initialIndex={1}
          initialSentenceIndex={1}
        />
      </ChakraProvider>,
    );

    expect(await screen.findByTestId('sentence-1-1')).toHaveAttribute('data-active', 'true');
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^播放$/i })).toBeInTheDocument();
  });

  test('pressing play right after opening resumes exactly at the saved Sentence, not the start of its Chunk', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer
          bookId="book-resume-sentence-2"
          chunks={twoSentenceChunks}
          initialIndex={1}
          initialSentenceIndex={1}
        />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);

    const audioEl = screen.getByTestId('audio-element');
    await waitFor(() => expect(audioEl.currentTime).toBe(1));
    expect(screen.getByTestId('sentence-1-1')).toHaveAttribute('data-active', 'true');
  });
});

describe('AudioPlayer report mode wiring', () => {
  const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];

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

  function selectText(text) {
    window.getSelection = vi.fn(() => ({ toString: () => text }));
    fireEvent.mouseUp(screen.getByRole('log', { name: /書籍內文/i }));
  }

  test('toggling report mode from the bottom bar disables Sentence-click seeking and surfaces the report form on selection', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-report" chunks={twoSentenceChunks} title="A Book" />
      </ChakraProvider>,
    );

    // Sanity: clicking works normally before report mode is entered.
    fireEvent.click(screen.getByTestId('sentence-0-1'));
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');

    fireEvent.click(screen.getByRole('button', { name: /回報發音問題/i }));

    fireEvent.click(screen.getByTestId('sentence-1-0'));
    // Still queued on the earlier sentence - the report-mode click was a no-op.
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sentence-1-0')).not.toHaveAttribute('data-active');

    selectText('第一句');
    expect(screen.getByTestId('pronunciation-report-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByTestId('pronunciation-report-modal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /回報發音問題/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Report mode has fully exited - Sentence-click seeking works again.
    fireEvent.click(screen.getByTestId('sentence-1-0'));
    expect(screen.getByTestId('sentence-1-0')).toHaveAttribute('data-active', 'true');
  });
});

describe('AudioPlayer background/foreground resync', () => {
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

  test('returning to the foreground with the active element actually paused corrects a stale Pause button back to Play', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-1" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    // The mocked play() never actually flips .paused - standing in for the OS having
    // suspended or killed playback while the tab was hidden.
    setVisibilityState('hidden');
    setVisibilityState('visible');

    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
  });

  test('returning to the foreground pauses a standby element that ended up playing, so the two never overlap', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-2" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    // Per-instance spies (rather than the shared prototype mock) so this proves the
    // *standby* element specifically gets paused, not just that pause() fired on
    // whichever element - a regression pausing the active element instead would leave
    // the prototype-level assertion equally green.
    const activeEl = screen.getByTestId('audio-element');
    const standbyEl = screen.getByTestId('audio-element-standby');
    const activePause = vi.fn();
    const standbyPause = vi.fn();
    activeEl.pause = activePause;
    standbyEl.pause = standbyPause;
    Object.defineProperty(standbyEl, 'paused', { value: false, configurable: true });

    setVisibilityState('hidden');
    setVisibilityState('visible');

    expect(standbyPause).toHaveBeenCalledTimes(1);
    expect(activePause).not.toHaveBeenCalled();
  });

  test('pressing play also pauses a standby element that was already (stray) playing, without needing a visibility change', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-2b" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    // Stray playback on the standby element, present from before Play is ever pressed -
    // the load-and-play effect's own audio.play() calls must enforce the invariant too,
    // not only the visibilitychange reconciliation checkpoint.
    const standbyEl = screen.getByTestId('audio-element-standby');
    const standbyPause = vi.fn();
    standbyEl.pause = standbyPause;
    Object.defineProperty(standbyEl, 'paused', { value: false, configurable: true });

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    expect(standbyPause).toHaveBeenCalled();
  });

  test('returning to the foreground recomputes the highlighted sentence from currentTime, without a further timeupdate event', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    // Simulates timeupdate having been throttled while hidden: the element's own
    // currentTime moved on to the second Sentence, but the highlight never followed.
    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;

    setVisibilityState('hidden');
    setVisibilityState('visible');

    await waitFor(() =>
      expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true'),
    );
  });

  test('returning to the foreground advances to the next chunk if the active element ended while hidden', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-4" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const standbyEl = screen.getByTestId('audio-element-standby');
    await waitFor(() => expect(standbyEl.src).toBe('https://blob.test/1'));

    // The active element reached the end while hidden, without its `ended` event ever
    // being processed - standing in for a chunk boundary crossed entirely off-screen.
    const audioEl = screen.getByTestId('audio-element');
    Object.defineProperty(audioEl, 'ended', { value: true, configurable: true });

    setVisibilityState('hidden');
    setVisibilityState('visible');

    // Chunk 1's audio (already preloaded into the standby element - see ticket 05)
    // becomes active without a fresh src load, exactly as a live `ended` event would.
    await waitFor(() => expect(standbyEl).toHaveAttribute('data-active', 'true'));
    expect(standbyEl.src).toBe('https://blob.test/1');
  });

  test('retries a stalled .play() call whose currentTime never left 0 despite audio.paused reporting false', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-5" chunks={chunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    // Standing in for .play() flipping `paused` to false right as the OS suspended the
    // tab before any real audio started - currentTime never moves off 0 (see Phase 1.9
    // ticket 04, diagnosed from a real diagnostic-log capture showing exactly this).
    const audioEl = screen.getByTestId('audio-element');
    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true });

    nowSpy.mockReturnValue(1_000 + 2_000 + 1);
    setVisibilityState('hidden');
    setVisibilityState('visible');

    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  });

  test('does not retry a chunk that only just started, even if paused reports false with currentTime 0', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-6" chunks={chunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    const audioEl = screen.getByTestId('audio-element');
    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true });

    // Still well within the startup grace window - not enough time has passed to call
    // this a stall yet.
    nowSpy.mockReturnValue(1_000 + 500);
    setVisibilityState('hidden');
    setVisibilityState('visible');

    // setVisibilityState dispatches synchronously, and the reconciliation checkpoint it
    // triggers runs synchronously within that same dispatch - no further await needed.
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('does not treat genuine progress as a stall', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-7" chunks={chunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    const audioEl = screen.getByTestId('audio-element');
    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true });
    // Genuinely progressed past 0 - not stalled, regardless of how long it's been.
    Object.defineProperty(audioEl, 'currentTime', { value: 3.2, configurable: true });

    nowSpy.mockReturnValue(1_000 + 10_000);
    setVisibilityState('hidden');
    setVisibilityState('visible');

    // setVisibilityState dispatches synchronously, and the reconciliation checkpoint it
    // triggers runs synchronously within that same dispatch - no further await needed.
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});

describe('AudioPlayer background flush of resume-position persistence', () => {
  const twoSentenceChunks = ['第一句。第二句。', '第三句。第四句。'];
  const boundaries = [
    { text: '第一句', offset: 0, duration: 10_000_000 },
    { text: '第二句', offset: 10_000_000, duration: 10_000_000 },
  ];

  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries }), {
        status: 200,
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('backgrounding immediately flushes a pending debounced write, without waiting for the 400ms debounce', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-1" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    // Asserted synchronously, right after dispatching and before the 400ms debounce
    // would otherwise have any chance to fire - proving this went through the
    // immediate flush path, not the debounce.
    setVisibilityState('hidden');

    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 0,
      resumeSentenceIndex: 1,
    });
  });

  test('pagehide triggers the same immediate flush, as a fallback for a killed process that skips visibilitychange', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-2" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    fireEvent(window, new Event('pagehide'));

    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 0,
      resumeSentenceIndex: 1,
    });
  });

  test('does not fire a duplicate persistence call when the debounce timer already covered the same (chunk, sentence) pair', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 1,
      }),
    );
    const patchCallCountAfterDebounce = libraryPatchCalls().length;

    setVisibilityState('hidden');

    expect(libraryPatchCalls()).toHaveLength(patchCallCountAfterDebounce);
  });

  test('ordinary foreground debounce/coalescing is unaffected - rapid successive advances still coalesce into one write', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-4" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-flush-4'),
    );
    const patchCallCountAfterMount = libraryPatchCalls().length;

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;
    fireEvent.timeUpdate(audioEl);
    audioEl.currentTime = 1.6;
    fireEvent.timeUpdate(audioEl);

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 1,
      }),
    );
    expect(libraryPatchCalls()).toHaveLength(patchCallCountAfterMount + 1);
  });
});

describe('AudioPlayer MediaSession integration', () => {
  const chunks = ['第一段。', '第二段。'];

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
    // Unmount before removing the mediaSession mock (rather than relying on the global
    // afterEach's own cleanup(), which runs after this one) - the hook's own unmount
    // cleanup calls navigator.mediaSession.setActionHandler and would otherwise throw
    // against an already-deleted mock.
    cleanup();
    vi.restoreAllMocks();
    delete navigator.mediaSession;
    delete global.MediaMetadata;
  });

  // jsdom doesn't implement the MediaSession API - these two stand in for a browser
  // that does, giving each handler its own spy so tests can tell 'play' apart from
  // 'pause' registrations.
  function mockMediaSession() {
    navigator.mediaSession = {
      setActionHandler: vi.fn(),
      metadata: null,
      playbackState: 'none',
    };
    global.MediaMetadata = vi.fn(function MediaMetadata(init) {
      Object.assign(this, init);
    });
    return navigator.mediaSession;
  }

  function registeredHandler(mediaSession, action) {
    const call = mediaSession.setActionHandler.mock.calls.find(([name]) => name === action);
    return call?.[1];
  }

  test('registers play/pause action handlers wired to the same play/pause the PlayerBar button uses', async () => {
    const mediaSession = mockMediaSession();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-1" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });

    await waitFor(() => expect(registeredHandler(mediaSession, 'play')).toBeInstanceOf(Function));
    expect(registeredHandler(mediaSession, 'pause')).toBeInstanceOf(Function);

    registeredHandler(mediaSession, 'play')();
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    registeredHandler(mediaSession, 'pause')();
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  test('clears the action handlers, metadata, and playbackState on unmount', async () => {
    const mediaSession = mockMediaSession();

    const { unmount } = render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-2" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });
    await waitFor(() => expect(registeredHandler(mediaSession, 'play')).toBeInstanceOf(Function));
    await waitFor(() => expect(mediaSession.metadata).not.toBeNull());

    unmount();

    const playCalls = mediaSession.setActionHandler.mock.calls.filter(([name]) => name === 'play');
    const pauseCalls = mediaSession.setActionHandler.mock.calls.filter(
      ([name]) => name === 'pause',
    );
    expect(playCalls.at(-1)[1]).toBeNull();
    expect(pauseCalls.at(-1)[1]).toBeNull();
    // A Listener navigating back to the Library shouldn't leave this Book's title (or a
    // stale "playing") on the OS lock screen once nothing is actually playing.
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe('none');
  });

  test("sets MediaMetadata to the Book's title", async () => {
    mockMediaSession();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-3" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });

    await waitFor(() => expect(navigator.mediaSession.metadata).not.toBeNull());
    expect(navigator.mediaSession.metadata.title).toBe('我的書');
  });

  test('keeps playbackState in sync with play/pause', async () => {
    mockMediaSession();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-4" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    expect(navigator.mediaSession.playbackState).toBe('paused');

    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    expect(navigator.mediaSession.playbackState).toBe('playing');

    fireEvent.click(screen.getByRole('button', { name: /暫停/i }));
    await screen.findByRole('button', { name: /^播放$/i });
    expect(navigator.mediaSession.playbackState).toBe('paused');
  });

  test("doesn't throw and playback still works when the browser has no MediaSession support", async () => {
    expect('mediaSession' in navigator).toBe(false);

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-5" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /暫停/i }));
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
  });
});

// TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js. Delete
// alongside the logging call sites once ticket 04 ships.
describe('AudioPlayer background diagnostics logging', () => {
  beforeEach(() => {
    localStorage.clear();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();

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

  test('logs visibilitychange events with the resulting visibilityState', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-diagnostics-1" chunks={chunks} />
      </ChakraProvider>,
    );
    await screen.findByRole('button', { name: /^播放$/i });

    setVisibilityState('hidden');
    setVisibilityState('visible');

    const log = getDiagnosticLog();
    expect(log.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['visibilitychange', 'visibilitychange']),
    );
    const hiddenEntry = log.find(
      (entry) => entry.type === 'visibilitychange' && entry.detail.visibilityState === 'hidden',
    );
    expect(hiddenEntry).toBeDefined();
  });

  test('logs a reconcile entry every time the foreground checkpoint runs', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-diagnostics-2" chunks={chunks} />
      </ChakraProvider>,
    );
    await screen.findByRole('button', { name: /^播放$/i });

    setVisibilityState('hidden');
    setVisibilityState('visible');

    const log = getDiagnosticLog();
    expect(log.some((entry) => entry.type === 'reconcile')).toBe(true);
  });

  test('logs both the from and to Sentence index when reconciliation corrects the highlight', async () => {
    const twoSentenceChunks = ['第一句。第二句。'];
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      return new Response(
        JSON.stringify({
          url: `https://blob.test/${chunkIndex}`,
          boundaries: [
            { text: '第一句', offset: 0, duration: 10_000_000 },
            { text: '第二句', offset: 10_000_000, duration: 10_000_000 },
          ],
        }),
        { status: 200 },
      );
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-diagnostics-2b" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );
    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });

    // Simulates timeupdate having been throttled while hidden - the element's own
    // currentTime moved on to the second Sentence, but the highlight never followed.
    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 1.5;

    setVisibilityState('hidden');
    setVisibilityState('visible');

    await waitFor(() =>
      expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true'),
    );

    const log = getDiagnosticLog();
    const correctionEntry = log.find(
      (entry) => entry.type === 'reconcile' && entry.detail.sentenceIndexCorrectedTo === 1,
    );
    expect(correctionEntry).toBeDefined();
    expect(correctionEntry.detail.sentenceIndexCorrectedFrom).toBe(0);
  });

  test('logs MediaSession registration outcome on mount', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-diagnostics-3" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );
    await screen.findByRole('button', { name: /^播放$/i });

    const log = getDiagnosticLog();
    const registrationEntry = log.find((entry) => entry.type === 'mediaSessionRegistration');
    expect(registrationEntry).toBeDefined();
    expect(registrationEntry.detail.supported).toBe('mediaSession' in navigator);
  });
});
