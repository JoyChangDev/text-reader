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

  test('plays the Book from one element pointed at its playlist, and supports play/pause', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={chunks} />
      </ChakraProvider>,
    );

    // Generation still runs Chunk by Chunk through /api/audio-chunks - that is what makes
    // the playlist grow - and this Book is shorter than the look-ahead window.
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    expect(audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex)).toEqual([
      0, 1, 2, 3,
    ]);

    // One source for the whole Book, not one file per Chunk: the element is pointed at
    // the (Book, voice) playlist and the media stack moves between segments itself.
    const audioEl = screen.getByTestId('audio-element');
    expect(audioEl.src).toContain('/api/books/book-1/playlist.m3u8');
    expect(audioEl.src).toContain('voice=zh-TW-HsiaoChenNeural');
    expect(screen.queryByTestId('audio-element-standby')).not.toBeInTheDocument();
    // `crossorigin` would impose a CORS requirement on segment responses that nothing
    // here needs - no <track src>, nothing reading the audio data (see ticket 04).
    expect(audioEl).not.toHaveAttribute('crossorigin');

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    expect(playButton).toBeEnabled();
    fireEvent.click(playButton);

    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();

    const pauseButton = screen.getByRole('button', { name: /暫停/i });
    fireEvent.click(pauseButton);

    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
  });

  // The whole point of the phase: a second .play() on a freshly-loaded element is what
  // fails in the background (ADR 0003), so no boundary may ever need one. Playback here
  // runs the length of several Chunks without the Listener touching anything.
  test('calls play() exactly once across a Book that crosses several Chunk boundaries', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-continuous" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    fireEvent.click(await screen.findByRole('button', { name: /^播放$/i }));
    await screen.findByRole('button', { name: /暫停/i });

    const audioEl = screen.getByTestId('audio-element');
    // ~12s per Chunk, so this walks the continuous timeline across four of them. Nothing
    // in the app reacts to a Chunk ending, because nothing is told about one.
    for (let seconds = 1; seconds <= 48; seconds += 1) {
      audioEl.currentTime = seconds;
      fireEvent.timeUpdate(audioEl);
    }

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /暫停/i })).toBeInTheDocument();
  });

  test('resumes at a given initialIndex without requesting earlier chunks', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resume" chunks={chunks} initialIndex={2} />
      </ChakraProvider>,
    );

    // Look-ahead runs forward from index 2 - chunks 0 and 1 were already heard in an
    // earlier session and are never requested.
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

  test('a failed chunk does not block unrelated cached chunks, and moving onto it regenerates it without a second play()', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /暫停/i }));
    await screen.findByRole('button', { name: /^播放$/i });

    // Moving the reading position onto the failed chunk regenerates it (Sentence clicks
    // are ignored while playing - see the playback lock).
    fireEvent.click(screen.getByTestId('sentence-1-0'));

    await waitFor(() => expect(chunk1Attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    // Regenerating doesn't restart the element: the source is the Book's playlist, which
    // the media stack re-fetches on its own once the Chunk lands in it.
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    expect(JSON.parse(audioChunkFetchCalls()[0][1].body).voice).toBe('zh-TW-HsiaoChenNeural');
  });

  test('changing the voice re-points the playlist and applies to subsequently fetched chunks only', async () => {
    // Longer than the look-ahead window, so chunks are left for the new voice to fetch.
    const longBook = Array.from({ length: 15 }, (unused, index) => `第${index}段。`);
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-1" chunks={longBook} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(11));
    openSettings();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
        name: 'Yun-Jhe',
      }),
    );

    expect(getListenerSettings().voice).toBe('zh-TW-YunJheNeural');

    // A voice change is the one thing that legitimately re-points the element's source,
    // since the playlist is per (Book, voice) - see ticket 04.
    const audioEl = screen.getByTestId('audio-element');
    await waitFor(() => expect(audioEl.src).toContain('voice=zh-TW-YunJheNeural'));

    // Chunks 13 and 14 were outside the look-ahead window at mount, so they are the
    // first requests made after the voice change - and the first to use it. Chunks
    // already generated under the old voice are left exactly as they are.
    const callsBeforeChange = audioChunkFetchCalls().length;
    fireEvent.click(screen.getByTestId('sentence-13-0'));

    await waitFor(() => expect(audioChunkFetchCalls().length).toBeGreaterThan(callsBeforeChange));
    const bodiesAfterChange = audioChunkFetchCalls()
      .slice(callsBeforeChange)
      .map(([, init]) => JSON.parse(init.body));
    expect(bodiesAfterChange.map(({ chunkIndex }) => chunkIndex)).toContain(13);
    bodiesAfterChange.forEach((body) => expect(body.voice).toBe('zh-TW-YunJheNeural'));
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

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
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

  // Loading a source resets playbackRate to its default, and a voice change is the one
  // thing that loads a new one - so the selected speed has to be re-applied with it.
  test('a selected speed survives the voice change that re-points the playlist', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-speed-3" chunks={chunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(4));
    openSettings();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /播放速度/i })).getByRole('radio', {
        name: '2x',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
        name: 'Yun-Jhe',
      }),
    );

    const audioEl = screen.getByTestId('audio-element');
    await waitFor(() => expect(audioEl.src).toContain('voice=zh-TW-YunJheNeural'));
    expect(audioEl.playbackRate).toBe(2);
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

  // Highlighting the Sentence that is actually playing needs absolute cue times, which
  // ticket 05 brings in - the previous timeupdate-driven lookup is gone rather than left
  // reading a Chunk-relative offset off a Book-wide clock. What survives here is the
  // Listener-driven half: the selected Sentence is highlighted and scrolled to.
  test('highlights and auto-scrolls to the selected sentence', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-hl" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^播放$/i })).toBeEnabled());

    fireEvent.click(screen.getByTestId('sentence-0-1'));

    await waitFor(() =>
      expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByTestId('sentence-0-0')).not.toHaveAttribute('data-active');
    expect(window.Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  // A Book-wide clock says nothing about which Sentence is playing until ticket 05's
  // cues arrive - so it must not move the highlight, and above all must not overwrite
  // the Listener's saved place with a Sentence it guessed.
  test('does not move the highlight or the saved position as the clock advances', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-hl-2" chunks={twoSentenceChunks} initialSentenceIndex={1} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: /^播放$/i }));
    await screen.findByRole('button', { name: /暫停/i });
    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-hl-2'),
    );
    const patchCallsBefore = libraryPatchCalls().length;

    const audioEl = screen.getByTestId('audio-element');
    audioEl.currentTime = 30;
    fireEvent.timeUpdate(audioEl);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(libraryPatchCalls()).toHaveLength(patchCallsBefore);
  });

  // Auto-scroll suspension on manual scroll is TranscriptView's own behavior,
  // unit-tested in isolation there (see ticket 07) - not re-asserted here.

  test('clicking a sentence while paused highlights it without starting playback; pressing play then starts', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-seek" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /^播放$/i })).toBeEnabled());

    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Selecting a sentence while paused only marks the reading position (see phase 1.5
    // ticket 02) - nothing plays until Play is pressed. Moving audio.currentTime to that
    // Sentence is ticket 05's job: a Sentence's offset is relative to its own Chunk, and
    // this element's timeline runs across the whole Book.
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^播放$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^播放$/i }));

    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('clicking a sentence in a not-yet-generated chunk generates only that chunk, not the ones skipped over', async () => {
    // Longer than the look-ahead window, so chunk 15 is genuinely outside it.
    const longBook = Array.from({ length: 20 }, (unused, index) =>
      index === 15 ? '第十六段之一。第十六段之二。' : `第${index}段。`,
    );
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      const boundaries =
        chunkIndex === 15
          ? [
              { text: '第十六段之一', offset: 0, duration: 10_000_000 },
              { text: '第十六段之二', offset: 10_000_000, duration: 10_000_000 },
            ]
          : [];
      return new Response(JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries }), {
        status: 200,
      });
    });

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-jump" chunks={longBook} />
      </ChakraProvider>,
    );

    // Initial look-ahead from chunk 0 covers chunks 0-10 only.
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(11));

    fireEvent.click(screen.getByTestId('sentence-15-1'));

    await waitFor(() =>
      expect(screen.getByTestId('sentence-15-1')).toHaveAttribute('data-active', 'true'),
    );

    const requestedChunkIndexes = () =>
      audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex);
    await waitFor(() => expect(requestedChunkIndexes()).toContain(15));
    expect(requestedChunkIndexes().filter((index) => index === 15)).toHaveLength(1);
    // Chunks 11-14 sat between the initial look-ahead and the jump target - jumping
    // ahead must not force generating any of them first.
    expect(requestedChunkIndexes().filter((index) => index >= 11 && index <= 14)).toEqual([]);
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

  test('clicking a different sentence while paused moves the highlight without resuming playback', async () => {
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

    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Selecting a Sentence never resumes playback on its own (see phase 1.5 ticket 02).
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^播放$/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^播放$/i }));

    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
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

  test('persists the current chunk and sentence index together to the library as the reading position moves', async () => {
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

    fireEvent.click(screen.getByTestId('sentence-1-0'));

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

  // Until ticket 05's cues advance the Sentence on their own, the debounced path is
  // exercised by the write every Book makes when it opens.
  test('debounces the position write a Book makes when it opens', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-persist-debounce" chunks={chunks} initialIndex={1} />
      </ChakraProvider>,
    );

    // Nothing goes out synchronously with the mount - the write is scheduled, not sent.
    expect(libraryPatchCalls()).toHaveLength(0);

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 1,
        resumeSentenceIndex: 0,
      }),
    );
    expect(libraryPatchCalls()).toHaveLength(1);
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

  // Where the saved Sentence sits on the Book's continuous timeline is a cue time, which
  // ticket 05 brings in - until then pressing play starts the playlist and keeps the
  // saved Sentence highlighted, rather than seeking to a Chunk-relative offset that would
  // land somewhere else entirely.
  test('pressing play right after opening starts playback with the saved Sentence still selected', async () => {
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

    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
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

  // Nothing may call play() on the way back to the foreground: a background play() on a
  // freshly-loaded element is the failure ADR 0003 identified, and with one continuous
  // source there is nothing left that would need one.
  test('never calls play() when returning to the foreground', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-2" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    const playButton = await screen.findByRole('button', { name: /^播放$/i });
    fireEvent.click(playButton);
    await screen.findByRole('button', { name: /暫停/i });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    const audioEl = screen.getByTestId('audio-element');
    // Playing normally, just with its events throttled while hidden.
    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true });
    Object.defineProperty(audioEl, 'ended', { value: false, configurable: true });

    setVisibilityState('hidden');
    setVisibilityState('visible');
    fireEvent(window, new Event('focus'));

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test('returning to the foreground with the element genuinely playing corrects a stale Play button back to Pause', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-resync-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });

    const audioEl = screen.getByTestId('audio-element');
    Object.defineProperty(audioEl, 'paused', { value: false, configurable: true });

    setVisibilityState('hidden');
    setVisibilityState('visible');

    expect(await screen.findByRole('button', { name: /暫停/i })).toBeInTheDocument();
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
        <AudioPlayer bookId="book-flush-1" chunks={twoSentenceChunks} initialIndex={1} />
      </ChakraProvider>,
    );

    // Asserted synchronously, before the 400ms debounce has any chance to fire - proving
    // this went through the immediate flush path, not the debounce.
    expect(libraryPatchCalls()).toHaveLength(0);
    setVisibilityState('hidden');

    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 1,
      resumeSentenceIndex: 0,
    });
  });

  test('pagehide triggers the same immediate flush, as a fallback for a killed process that skips visibilitychange', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-2" chunks={twoSentenceChunks} initialIndex={1} />
      </ChakraProvider>,
    );

    expect(libraryPatchCalls()).toHaveLength(0);
    fireEvent(window, new Event('pagehide'));

    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 1,
      resumeSentenceIndex: 0,
    });
  });

  test('does not fire a duplicate persistence call when the debounce timer already covered the same (chunk, sentence) pair', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 0,
      }),
    );
    const patchCallCountAfterDebounce = libraryPatchCalls().length;

    setVisibilityState('hidden');

    expect(libraryPatchCalls()).toHaveLength(patchCallCountAfterDebounce);
  });

  // Coalescing rapid *automatic* Sentence advances is the debounce's real job, and
  // nothing advances the Sentence on its own until ticket 05's cues do. What is testable
  // here is the other half of the same contract: an explicit Sentence click bypasses the
  // debounce entirely and persists at once.
  test('an explicit Sentence click bypasses the debounce instead of coalescing into it', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-4" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(libraryPatchCalls().map(([url]) => url)).toContain('/api/library/book-flush-4'),
    );
    const patchCallCountAfterMount = libraryPatchCalls().length;

    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Synchronous, not after the 400ms debounce.
    expect(libraryPatchCalls()).toHaveLength(patchCallCountAfterMount + 1);
    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 0,
      resumeSentenceIndex: 1,
    });
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
