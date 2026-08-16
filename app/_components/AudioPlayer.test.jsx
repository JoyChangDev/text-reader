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
// `buildManifest` is read fresh on every request so a test can grow the Book's cue set
// between requests, the way the real route does as Chunks generate (see ticket 05).
function mockAudioChunkFetch(handleAudioChunk, buildManifest = () => ({ chunks: [] })) {
  global.fetch = vi.fn(async (url, init) => {
    if (typeof url === 'string' && url.includes('/manifest')) {
      return new Response(JSON.stringify(buildManifest(url)), { status: 200 });
    }
    if (url !== '/api/audio-chunks') {
      return new Response('{}', { status: 200 });
    }
    return handleAudioChunk(init);
  });
}

function audioChunkFetchCalls() {
  return global.fetch.mock.calls.filter(([url]) => url === '/api/audio-chunks');
}

// The metadata track the player builds its highlighting on - see vitest.setup.js for the
// jsdom stand-ins that make `addTextTrack`/`VTTCue` exist at all.
function metadataTrack() {
  return screen.getByTestId('audio-element').textTracks[0];
}

// Stands in for the media stack noticing the playhead entered a cue. Only the id matters
// to the player: it is the Book-global Sentence ordinal.
function fireCueChange(ordinal) {
  const track = metadataTrack();
  track.activeCues = [track.cues.getCueById(String(ordinal)) ?? { id: String(ordinal) }];
  track.dispatchEvent(new Event('cuechange'));
}

// Records every write to the element's `src`, so a test can assert a seek moved the
// playhead without reloading the element - a reload mid-Book is the interruption this
// whole phase exists to remove (see ADR 0003).
function recordSrcAssignments(audioElement) {
  const assignments = [];
  const inherited = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(audioElement), 'src') ?? {
    get: () => '',
    set: () => {},
  };

  Object.defineProperty(audioElement, 'src', {
    configurable: true,
    get: () => inherited.get.call(audioElement),
    set: (value) => {
      assignments.push(value);
      inherited.set.call(audioElement, value);
    },
  });

  return assignments;
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

  // The element populates `error` and stops, silently: on a browser with no HLS demuxer
  // (every desktop one but Safari - see ADR 0003) the playlist is refused with
  // MEDIA_ERR_SRC_NOT_SUPPORTED and the play button simply did nothing. The defect is the
  // silence, not the lack of support (see ticket 06).
  describe('when the element itself refuses the source', () => {
    function failWith(code, message) {
      const audioEl = screen.getByTestId('audio-element');
      Object.defineProperty(audioEl, 'error', { value: { code, message }, configurable: true });
      fireEvent.error(audioEl);
      return audioEl;
    }

    test('says the browser cannot play the source instead of leaving a dead play button', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ChakraProvider>
          <AudioPlayer bookId="book-unsupported" chunks={chunks} />
        </ChakraProvider>,
      );
      await screen.findByRole('button', { name: /^播放$/i });

      failWith(4, 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE');

      expect(await screen.findByRole('alert')).toHaveTextContent(/無法播放/);
      expect(console.error).toHaveBeenCalled();
    });

    test('stops showing Pause once the element has given up', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ChakraProvider>
          <AudioPlayer bookId="book-unsupported" chunks={chunks} />
        </ChakraProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: /^播放$/i }));
      await screen.findByRole('button', { name: /暫停/i });

      failWith(4, 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE');

      expect(await screen.findByRole('button', { name: /^播放$/i })).toBeInTheDocument();
    });

    // A decode or network failure is not a browser that can never play this Book, so it
    // must not be reported as one.
    test('reports a failure that is not about support in its own words', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ChakraProvider>
          <AudioPlayer bookId="book-decode" chunks={chunks} />
        </ChakraProvider>,
      );
      await screen.findByRole('button', { name: /^播放$/i });

      failWith(3, 'decode error');

      expect(await screen.findByRole('alert')).toHaveTextContent(/播放時發生錯誤/);
    });

    // Re-pointing the element is a fresh attempt at a different source - keeping the old
    // failure on screen would say the new one had failed too, before it had loaded.
    test('clears the failure when the Book is re-pointed at another source', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <ChakraProvider>
          <AudioPlayer bookId="book-voice-change" chunks={chunks} />
        </ChakraProvider>,
      );
      await screen.findByRole('button', { name: /^播放$/i });
      failWith(4, 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE');
      await screen.findByRole('alert');

      openSettings();
      fireEvent.click(
        within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
          name: 'Yun-Jhe',
        }),
      );

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
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

  // What /api/books/[bookId]/manifest returns for the Book above once both Chunks have
  // generated: Sentence ids run straight through the Chunk boundary, and Chunk 1's times
  // are offset by Chunk 0's duration - one Book-wide timeline (see ticket 03).
  const twoChunkManifest = {
    chunks: [
      {
        index: 0,
        isGenerated: true,
        startSeconds: 0,
        sentences: [
          { id: 0, startSeconds: 0, endSeconds: 1 },
          { id: 1, startSeconds: 1, endSeconds: 2 },
        ],
      },
      {
        index: 1,
        isGenerated: true,
        startSeconds: 2,
        sentences: [
          { id: 2, startSeconds: 2, endSeconds: 3 },
          { id: 3, startSeconds: 3, endSeconds: 4 },
        ],
      },
    ],
  };

  function chunkAudioResponse(chunkIndex) {
    return new Response(
      JSON.stringify({
        url: `https://blob.test/${chunkIndex}`,
        boundaries: boundariesByChunk[chunkIndex] ?? [],
      }),
      { status: 200 },
    );
  }

  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    mockAudioChunkFetch(
      ({ body }) => chunkAudioResponse(JSON.parse(body).chunkIndex),
      () => twoChunkManifest,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('builds one hidden metadata track for the Book', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-track" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(2));

    expect(screen.getByTestId('audio-element').textTracks).toHaveLength(1);
    expect(metadataTrack().kind).toBe('metadata');
    // Load-bearing: cues in a `disabled` track never become active, so `cuechange` would
    // never fire and nothing would ever be highlighted.
    expect(metadataTrack().mode).toBe('hidden');
  });

  test("adds a Chunk's Sentences as cues at their absolute times when the manifest arrives", async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-cues" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(metadataTrack().cues).toHaveLength(4));

    expect(
      [...metadataTrack().cues].map(({ id, startTime, endTime }) => [id, startTime, endTime]),
    ).toEqual([
      ['0', 0, 1],
      ['1', 1, 2],
      // Chunk 1's Sentences carry Book-global ids and Book-wide times, not Chunk-relative ones.
      ['2', 2, 3],
      ['3', 3, 4],
    ]);
  });

  // The manifest is re-read every time a Chunk finishes generating, and it always
  // describes the whole Book so far - so every read but the first re-describes Chunks
  // that already have cues.
  test('re-reading a Chunk in a later manifest does not duplicate its cues', async () => {
    const releaseChunk = {};
    mockAudioChunkFetch(
      ({ body }) => {
        const { chunkIndex } = JSON.parse(body);
        return new Promise((resolve) => {
          releaseChunk[chunkIndex] = () => resolve(chunkAudioResponse(chunkIndex));
        });
      },
      () => twoChunkManifest,
    );

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-dedupe" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(Object.keys(releaseChunk)).toHaveLength(2));

    releaseChunk[0]();
    await waitFor(() => expect(metadataTrack().cues).toHaveLength(4));

    // A second Chunk becoming ready re-reads the same manifest, listing Chunk 0 again.
    releaseChunk[1]();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(metadataTrack().cues).toHaveLength(4);
  });

  test('a cuechange names the playing Sentence', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-cuechange" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(metadataTrack().cues).toHaveLength(4));
    fireEvent.click(await screen.findByRole('button', { name: /^播放$/i }));

    // Cue 2 is the Book's third Sentence - the first of Chunk 1.
    fireCueChange(2);

    await waitFor(() =>
      expect(screen.getByTestId('sentence-1-0')).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByTestId('sentence-0-0')).not.toHaveAttribute('data-active');
  });

  // The look-ahead anchor moves with the cues, which is what keeps a Book longer than the
  // window generating ahead of playback instead of stopping at the end of the first burst
  // (see ticket 04's note, and ticket 06).
  test('a cuechange advances look-ahead generation to the Chunk now playing', async () => {
    const longBook = Array.from({ length: 20 }, (unused, index) => `第${index}段。`);
    const manifest = {
      chunks: longBook.map((unused, index) => ({
        index,
        isGenerated: index <= 10,
        startSeconds: index <= 10 ? index : null,
        sentences: index <= 10 ? [{ id: index, startSeconds: index, endSeconds: index + 1 }] : [],
      })),
    };
    mockAudioChunkFetch(
      ({ body }) => chunkAudioResponse(JSON.parse(body).chunkIndex),
      () => manifest,
    );

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-anchor" chunks={longBook} />
      </ChakraProvider>,
    );

    // The opening burst covers Chunks 0-10 and then stops, because nothing has moved yet.
    await waitFor(() => expect(audioChunkFetchCalls()).toHaveLength(11));

    fireCueChange(8);

    const requestedChunkIndexes = () =>
      audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex);
    await waitFor(() => expect(requestedChunkIndexes()).toContain(18));
  });

  // Highlighting the Sentence that is actually playing is cue-driven; what this covers is
  // the Listener-driven half - the selected Sentence is highlighted and scrolled to.
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

  // Cues are the only thing that names a Sentence. The clock on its own says nothing -
  // there is no timeupdate handler left to consult, and there must not be one: mapping a
  // Book-wide clock against Chunk-relative spans is what used to overwrite the Listener's
  // saved place with a guess.
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

    await waitFor(() => expect(metadataTrack().cues).toHaveLength(4));
    fireEvent.click(screen.getByTestId('sentence-0-1'));

    // Selecting a sentence while paused moves the playhead and marks the reading position
    // (see phase 1.5 ticket 02) - nothing plays until Play is pressed.
    expect(screen.getByTestId('sentence-0-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('audio-element').currentTime).toBe(1);
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

  // Every earlier segment is still in the playlist, so going back is a move along the
  // existing timeline - the element must not be reloaded to do it.
  test('seeking backwards applies immediately, without reloading the element', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-back" chunks={twoSentenceChunks} initialIndex={1} />
      </ChakraProvider>,
    );

    // Opened at Chunk 1, so the playhead starts partway in - a move back to 0 is a real
    // move, not the value it would already have held.
    const audioEl = screen.getByTestId('audio-element');
    await waitFor(() => expect(audioEl.currentTime).toBe(2));
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-0-0'));

    expect(audioEl.currentTime).toBe(0);
    expect(screen.getByTestId('sentence-0-0')).toHaveAttribute('data-active', 'true');
    expect(srcAssignments).toEqual([]);
  });

  // The one case where the playhead cannot move at once: the target Sentence has no cue,
  // because its Chunk isn't on the timeline yet. The Listener still sees where they
  // queued, and the write happens when the Chunk arrives.
  test('seeking past the generated region defers the playhead until that Chunk has cues', async () => {
    const longBook = Array.from({ length: 20 }, (unused, index) => `第${index}段。`);
    // Modelled on the real routes rather than scripted: a Chunk reaches the timeline only
    // once it and every Chunk before it has generated, because the playlist truncates at
    // the first gap (see hlsPlaylist.js) and the manifest follows it.
    const generated = new Set();
    const manifest = () => {
      let onTimeline = true;
      return {
        chunks: longBook.map((unused, index) => {
          const placeable = onTimeline && generated.has(index);
          if (!placeable) onTimeline = false;
          return {
            index,
            isGenerated: generated.has(index),
            startSeconds: placeable ? index : null,
            sentences: placeable ? [{ id: index, startSeconds: index, endSeconds: index + 1 }] : [],
          };
        }),
      };
    };

    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex } = JSON.parse(body);
      generated.add(chunkIndex);
      return chunkAudioResponse(chunkIndex);
    }, manifest);

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-defer" chunks={longBook} />
      </ChakraProvider>,
    );

    // The opening look-ahead burst reaches Chunk 10, so Chunk 11 is the first Sentence
    // past the end of the timeline.
    await waitFor(() => expect(metadataTrack().cues).toHaveLength(11));
    const audioEl = screen.getByTestId('audio-element');

    fireEvent.click(screen.getByTestId('sentence-11-0'));

    // The highlight moves at once and generation is requested, but there is no time on
    // the Book's timeline to write yet.
    expect(screen.getByTestId('sentence-11-0')).toHaveAttribute('data-active', 'true');
    expect(audioEl.currentTime).toBe(0);
    await waitFor(() =>
      expect(audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex)).toContain(
        11,
      ),
    );

    // Chunk 11 lands on the timeline, its cue appears, and the parked seek is applied.
    await waitFor(() => expect(audioEl.currentTime).toBe(11));
  });

  // A different voice is a different timeline - the same Sentence sits at a different
  // second. Cues from the old one aren't stale, they're wrong.
  test('changing the voice replaces the old timeline’s cues rather than adding to them', async () => {
    window.localStorage.clear();
    // The same four Sentences, at a slower voice's times.
    const slowerManifest = {
      chunks: twoChunkManifest.chunks.map((chunk) => ({
        ...chunk,
        startSeconds: chunk.startSeconds * 2,
        sentences: chunk.sentences.map((sentence) => ({
          ...sentence,
          startSeconds: sentence.startSeconds * 2,
          endSeconds: sentence.endSeconds * 2,
        })),
      })),
    };

    mockAudioChunkFetch(
      ({ body }) => chunkAudioResponse(JSON.parse(body).chunkIndex),
      (url) => (url.includes('YunJhe') ? slowerManifest : twoChunkManifest),
    );

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-voice-cues" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(metadataTrack().cues).toHaveLength(4));
    expect(metadataTrack().cues.getCueById('2').startTime).toBe(2);

    openSettings();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
        name: 'Yun-Jhe',
      }),
    );

    await waitFor(() => expect(metadataTrack().cues.getCueById('2')?.startTime).toBe(4));
    // Replaced, not appended to.
    expect(metadataTrack().cues).toHaveLength(4);
  });

  // While a seek is parked the playhead is still somewhere else, so it keeps crossing
  // cues that have nothing to do with where the Listener asked to be. Those must not drag
  // the highlight backwards - and above all must not overwrite the saved position with a
  // Sentence the Listener already moved away from.
  test('cues crossed while a seek is parked do not move the highlight off the queued Sentence', async () => {
    const longBook = Array.from({ length: 20 }, (unused, index) => `第${index}段。`);
    const generated = new Set();
    mockAudioChunkFetch(
      ({ body }) => {
        const { chunkIndex } = JSON.parse(body);
        generated.add(chunkIndex);
        return chunkAudioResponse(chunkIndex);
      },
      () => ({
        chunks: longBook.map((unused, index) => ({
          index,
          isGenerated: generated.has(index),
          // Frozen at the opening burst: Chunk 11 never reaches the timeline in this test,
          // so the seek below stays parked for its duration.
          startSeconds: index <= 10 ? index : null,
          sentences: index <= 10 ? [{ id: index, startSeconds: index, endSeconds: index + 1 }] : [],
        })),
      }),
    );

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-parked" chunks={longBook} />
      </ChakraProvider>,
    );

    await waitFor(() => expect(metadataTrack().cues).toHaveLength(11));
    fireEvent.click(screen.getByTestId('sentence-11-0'));
    expect(screen.getByTestId('sentence-11-0')).toHaveAttribute('data-active', 'true');

    const patchCallsBefore = libraryPatchCalls().length;
    // The playhead is still back at the start of the Book, crossing Chunk 0's cue.
    fireCueChange(0);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByTestId('sentence-11-0')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('sentence-0-0')).not.toHaveAttribute('data-active');
    expect(libraryPatchCalls()).toHaveLength(patchCallsBefore);
  });

  // Ticket 04 left resume unable to position the audio: the saved (Chunk, Sentence) had
  // no absolute time. A cue is that time.
  test('opening a Book part-way through positions the audio at the saved Sentence', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer
          bookId="book-resume-time"
          chunks={twoSentenceChunks}
          initialIndex={1}
          initialSentenceIndex={1}
        />
      </ChakraProvider>,
    );

    // The saved position is Chunk 1's second Sentence - Book-global Sentence 3, cued at 3s.
    await waitFor(() => expect(screen.getByTestId('audio-element').currentTime).toBe(3));
    expect(screen.getByTestId('sentence-1-1')).toHaveAttribute('data-active', 'true');
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

// A playlist truncates at its first gap, so a Sentence past a stretch that was never
// narrated can never be reached by the playlist growing. The Book is served from that
// Chunk instead - see ticket 07.
describe('AudioPlayer seeking past the generated region', () => {
  // One Sentence per Chunk, one second of audio each, so Book-global Sentence ordinal N
  // is Chunk N and sits at second N of a playlist that starts at Chunk 0.
  const longBook = Array.from({ length: 20 }, (unused, index) => `第${index}段。`);

  // Models the two real routes closely enough to test the client against them: the
  // timeline starts at `from`, truncates at the first gap at or after it, and ignores any
  // gap before it. Sentence ids stay Book-global whatever `from` is.
  function fakeRoutes() {
    // Keyed by voice, like the real cache (getCachedChunks takes bookId *and* voice), so
    // switching voice genuinely starts from nothing narrated.
    const generatedByVoice = new Map();
    const generatedFor = (voice) => {
      if (!generatedByVoice.has(voice)) generatedByVoice.set(voice, new Set());
      return generatedByVoice.get(voice);
    };

    const manifestFor = (url) => {
      const query = new URL(url, 'https://test.example').searchParams;
      const from = Number(query.get('from') ?? 0);
      const generated = generatedFor(query.get('voice'));
      let startSeconds = 0;
      let onTimeline = true;

      return {
        chunks: longBook.map((unused, index) => {
          const placeable = index >= from && onTimeline && generated.has(index);
          const entry = {
            index,
            isGenerated: generated.has(index),
            startSeconds: placeable ? startSeconds : null,
            sentences: placeable ? [{ id: index, startSeconds, endSeconds: startSeconds + 1 }] : [],
          };
          if (placeable) startSeconds += 1;
          else if (index >= from) onTimeline = false;
          return entry;
        }),
      };
    };

    return { generatedFor, manifestFor };
  }

  function requestedChunkIndexes() {
    return audioChunkFetchCalls().map(([, init]) => JSON.parse(init.body).chunkIndex);
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.Element.prototype.scrollIntoView = vi.fn();

    const { generatedFor, manifestFor } = fakeRoutes();
    mockAudioChunkFetch(({ body }) => {
      const { chunkIndex, voice } = JSON.parse(body);
      generatedFor(voice).add(chunkIndex);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    }, manifestFor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderAtOpeningBurst(bookId) {
    render(
      <ChakraProvider>
        <AudioPlayer bookId={bookId} chunks={longBook} />
      </ChakraProvider>,
    );

    // The opening look-ahead burst covers Chunks 0-10, so Chunk 11 is the first Sentence
    // past the end of the timeline and Chunks 12+ are past a gap.
    await waitFor(() => expect(metadataTrack().cues).toHaveLength(11));
    return screen.getByTestId('audio-element');
  }

  test('re-points the element at a playlist starting where the Listener landed', async () => {
    const audioEl = await renderAtOpeningBurst('book-repoint');
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-15-0'));

    await waitFor(() => expect(srcAssignments).toHaveLength(1));
    expect(srcAssignments[0]).toContain('from=15');
    expect(srcAssignments[0]).toContain('/api/books/book-repoint/playlist.m3u8');
  });

  // Ticket 15, found on a device: the re-point used to fire before the Chunk it had just
  // asked for existed. A playlist starting at an ungenerated Chunk truncates at its own first
  // entry, so the element was handed a source with no segments, errored, and never recovered -
  // nothing reassigns `src` when the Chunk later arrives. Every existing test here resolved
  // generation immediately, which is exactly why none of them saw it.
  test('does not re-point until the Chunk it is waiting for exists', async () => {
    let releaseChunk;
    const { generatedFor, manifestFor } = fakeRoutes();
    mockAudioChunkFetch(async ({ body }) => {
      const { chunkIndex, voice } = JSON.parse(body);
      if (chunkIndex === 15) {
        await new Promise((resolve) => {
          releaseChunk = resolve;
        });
      }
      generatedFor(voice).add(chunkIndex);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    }, manifestFor);

    const audioEl = await renderAtOpeningBurst('book-repoint-race');
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-15-0'));

    // The Listener is told the wait is happening, rather than facing a disabled button.
    expect(await screen.findByText(/正在準備這個段落/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        audioChunkFetchCalls().some(([, init]) => JSON.parse(init.body).chunkIndex === 15),
      ).toBe(true),
    );
    expect(srcAssignments).toHaveLength(0);

    releaseChunk();

    await waitFor(() => expect(srcAssignments).toHaveLength(1));
    expect(srcAssignments[0]).toContain('from=15');
    expect(screen.queryByText(/正在準備這個段落/)).not.toBeInTheDocument();
  });

  // The abandoned-target case. Without clearing what the playlist is waiting for, a long seek
  // the Listener changed their mind about would re-point the element minutes later, whenever
  // look-ahead happened to reach the Chunk it had wanted.
  test('a later reachable seek cancels a re-point that was still waiting', async () => {
    let releaseChunk;
    const { generatedFor, manifestFor } = fakeRoutes();
    mockAudioChunkFetch(async ({ body }) => {
      const { chunkIndex, voice } = JSON.parse(body);
      if (chunkIndex === 15) {
        await new Promise((resolve) => {
          releaseChunk = resolve;
        });
      }
      generatedFor(voice).add(chunkIndex);
      return new Response(
        JSON.stringify({ url: `https://blob.test/${chunkIndex}`, boundaries: [] }),
        { status: 200 },
      );
    }, manifestFor);

    const audioEl = await renderAtOpeningBurst('book-repoint-abandoned');
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-15-0'));
    await screen.findByText(/正在準備這個段落/);

    // Back to somewhere already on this timeline: no re-point, and the Chunk 15 wait is off.
    fireEvent.click(screen.getByTestId('sentence-6-0'));
    expect(audioEl.currentTime).toBe(6);

    releaseChunk();

    // Chunk 15 arriving must not now drag the element away from where the Listener is.
    await waitFor(() => expect(metadataTrack().cues.length).toBeGreaterThan(11));
    expect(srcAssignments).toHaveLength(0);
    expect(audioEl.currentTime).toBe(6);
  });

  test('plays from the target once its Chunk is on the new timeline', async () => {
    const audioEl = await renderAtOpeningBurst('book-repoint-time');

    // Somewhere other than zero first, so landing on the new timeline's zero is a move
    // rather than the value the element already held.
    fireEvent.click(screen.getByTestId('sentence-6-0'));
    expect(audioEl.currentTime).toBe(6);

    fireEvent.click(screen.getByTestId('sentence-15-0'));

    // Chunk 15 opens the new playlist, so it sits at its zero rather than at second 15.
    await waitFor(() => expect(metadataTrack().cues.getCueById('15')?.startTime).toBe(0));
    expect(audioEl.currentTime).toBe(0);
    expect(screen.getByTestId('sentence-15-0')).toHaveAttribute('data-active', 'true');
  });

  // Audio is cached per (Book, voice), so what the previous voice had narrated says
  // nothing about the new one. Trusting it would leave a seek parked against a playlist
  // that truncates before the target - the ticket 05 hang this ticket exists to close.
  test('does not treat the previous voice’s Chunks as reachable after a voice change', async () => {
    const audioEl = await renderAtOpeningBurst('book-voice-reach');

    openSettings();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /朗讀聲音/i })).getByRole('radio', {
        name: 'Yun-Jhe',
      }),
    );
    await waitFor(() => expect(audioEl.src).toContain('voice=zh-TW-YunJheNeural'));

    // The new voice has narrated nothing yet beyond its own opening burst, so Chunk 8 is
    // reachable only if the Chunks before it were generated for *this* voice.
    const srcAssignments = recordSrcAssignments(audioEl);
    fireEvent.click(screen.getByTestId('sentence-8-0'));

    // Either it is genuinely reachable and the seek lands, or the playlist moves - what
    // it must never do is park against a timeline that will never reach it.
    await waitFor(() => expect(srcAssignments.length > 0 || audioEl.currentTime > 0).toBe(true));
  });

  // The rule this preserves: what the Listener skipped is not narrated. That is the whole
  // reason the playlist moves rather than the gap being filled.
  test('never generates the Chunks that were skipped over', async () => {
    await renderAtOpeningBurst('book-skip');

    fireEvent.click(screen.getByTestId('sentence-15-0'));

    await waitFor(() => expect(requestedChunkIndexes()).toContain(15));
    // Look-ahead runs forward from the new position.
    await waitFor(() => expect(requestedChunkIndexes()).toContain(19));
    expect(requestedChunkIndexes().filter((index) => index >= 11 && index <= 14)).toEqual([]);
  });

  // Ticket 05's deferred seek is still the right answer when the playlist can grow to
  // reach the target - re-pointing there would reload the element for nothing.
  test('does not re-point for a target the playlist can still grow to reach', async () => {
    const audioEl = await renderAtOpeningBurst('book-contiguous');
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-11-0'));

    await waitFor(() => expect(audioEl.currentTime).toBe(11));
    expect(srcAssignments).toEqual([]);
  });

  test('does not re-point for a target already on the timeline', async () => {
    const audioEl = await renderAtOpeningBurst('book-within');
    const srcAssignments = recordSrcAssignments(audioEl);

    fireEvent.click(screen.getByTestId('sentence-4-0'));

    expect(audioEl.currentTime).toBe(4);
    expect(srcAssignments).toEqual([]);
  });

  // Going back to a Chunk the current playlist starts after needs the same treatment as
  // going forward past a gap: it isn't on this timeline, so the timeline has to move.
  test('goes back to a Chunk before the playlist start by re-pointing again', async () => {
    const audioEl = await renderAtOpeningBurst('book-back-across');

    fireEvent.click(screen.getByTestId('sentence-15-0'));
    await waitFor(() => expect(metadataTrack().cues.getCueById('15')?.startTime).toBe(0));

    const srcAssignments = recordSrcAssignments(audioEl);
    fireEvent.click(screen.getByTestId('sentence-3-0'));

    await waitFor(() => expect(srcAssignments).toHaveLength(1));
    expect(srcAssignments[0]).toContain('from=3');
    // Chunks 3-10 are generated and contiguous, so the new timeline covers them all.
    await waitFor(() => expect(metadataTrack().cues.getCueById('3')?.startTime).toBe(0));
    expect(metadataTrack().cues.getCueById('10')?.startTime).toBe(7);
    expect(screen.getByTestId('sentence-3-0')).toHaveAttribute('data-active', 'true');
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
      updatedAt: expect.any(Number),
      snapshot: false,
    });

    fireEvent.click(screen.getByTestId('sentence-1-0'));

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 1,
        resumeSentenceIndex: 0,
        updatedAt: expect.any(Number),
        snapshot: false,
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
        updatedAt: expect.any(Number),
        snapshot: false,
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
        updatedAt: expect.any(Number),
        snapshot: false,
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

    // snapshot: true only here. Backgrounding is the last moment the position is known
    // before the OS may kill the process, and it is the one place that asks for the
    // durable Blob copy - ordinary per-Sentence saves go to Redis alone (ticket 10).
    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 1,
      resumeSentenceIndex: 0,
      updatedAt: expect.any(Number),
      snapshot: true,
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
      updatedAt: expect.any(Number),
      snapshot: true,
    });
  });

  // This test used to assert the opposite - that backgrounding after the debounce had
  // already sent the same pair wrote nothing at all. That looked like duplicate suppression
  // and was in fact the bug in ticket 14: the debounced save is Redis-only, so skipping the
  // flush skipped the durable snapshot entirely. At a 400ms debounce against multi-second
  // Sentences the position is almost always already sent, and the live store confirmed it -
  // after a day of backgrounding, the Book had no resume.json at all.
  test('still takes a snapshot when the debounce already sent the same pair to Redis, because that write was not a snapshot', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-3" chunks={twoSentenceChunks} />
      </ChakraProvider>,
    );

    await waitFor(() =>
      expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
        resumeIndex: 0,
        resumeSentenceIndex: 0,
        updatedAt: expect.any(Number),
        snapshot: false,
      }),
    );

    setVisibilityState('hidden');

    expect(JSON.parse(libraryPatchCalls().at(-1)[1].body)).toEqual({
      resumeIndex: 0,
      resumeSentenceIndex: 0,
      updatedAt: expect.any(Number),
      snapshot: true,
    });
  });

  // The bound the flush's comment claims, and the reason ticket 10 moved the position out
  // of the index: backgrounding happens on every app switch and every lock, and a blob
  // write on each of those is the cost that was removed. Once a snapshot exists for a
  // position, further backgrounding at that same position is free.
  test('does not write a second snapshot when backgrounded again at the same position', async () => {
    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-flush-4" chunks={twoSentenceChunks} initialIndex={1} />
      </ChakraProvider>,
    );

    setVisibilityState('hidden');
    const afterFirstFlush = libraryPatchCalls().length;

    setVisibilityState('visible');
    setVisibilityState('hidden');

    expect(libraryPatchCalls()).toHaveLength(afterFirstFlush);
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
      updatedAt: expect.any(Number),
      snapshot: false,
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

  // Pinned because the failure is invisible from here: with no artwork the OS falls back to
  // a page icon and still shows *something* on the lock screen, so nothing looks broken
  // until you notice it is the wrong picture. See app/media-artwork/route.js.
  test('declares Now Playing artwork rather than letting the OS pick a page icon', async () => {
    mockMediaSession();

    render(
      <ChakraProvider>
        <AudioPlayer bookId="book-media-session-artwork" chunks={chunks} title="我的書" />
      </ChakraProvider>,
    );

    await screen.findByRole('button', { name: /^播放$/i });

    await waitFor(() => expect(navigator.mediaSession.metadata).not.toBeNull());
    expect(navigator.mediaSession.metadata.artwork).toEqual([
      { src: '/media-artwork', sizes: '512x512', type: 'image/png' },
    ]);
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
