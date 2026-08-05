'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { logDiagnosticEvent } from './backgroundDiagnostics';
import { updateResumeIndex } from './bookLibrary';
import { chunkFetchPlan } from './chunkFetchPlan';

// Roughly two minutes of audio ahead of the anchor, at the ~12s Chunks ticket 01
// measured on real edge-tts output. Raised from 2 because the media stack has to
// re-fetch a growing EVENT playlist to discover new segments, and reaching the end of
// the playlist is the one failure this phase can't rule out in advance (see the spec's
// Further Notes) - a wide generated region means playback rarely gets there. Not wider,
// because the whole plan is requested in parallel, so the window is also the size of the
// TTS burst a Book fires on open.
//
// The anchor is currentIndex, which nothing advances during playback until ticket 05's
// cues do - segment advancement left the app, so nothing tells it a Chunk ended. Until
// then this window is not a margin ahead of playback but the whole of what a listening
// session generates, and a Book longer than it stops at the end of the generated region.
// That is the one thing this ticket cannot deliver on its own; ticket 06 must re-check
// the value once the anchor moves again.
const LOOKAHEAD = 10;
// Natural playback can advance the active sentence roughly every few seconds - this
// coalesces those persistence writes into one trailing call instead of a network
// request on every single sentence boundary (see phase 1.5 ticket 05).
const RESUME_PERSIST_DEBOUNCE_MS = 400;

// The EVENT playlist for this (Book, voice) - one continuous source for the whole Book,
// served by /api/books/[bookId]/playlist.m3u8 (see ticket 03). It grows as Chunks
// generate, so the media stack keeps re-fetching it and moves between segments on its
// own; nothing in this hook runs at a Chunk boundary.
function playlistUrl(bookId, voice) {
  return `/api/books/${encodeURIComponent(bookId)}/playlist.m3u8?voice=${encodeURIComponent(voice)}`;
}

// Plays a Book as one continuous HLS source: the caller attaches `audioRef` to a single
// <audio> element whose `src` is the Book's EVENT playlist, and `.play()` is called
// exactly once per listening session, from the Listener's own gesture. Segment
// advancement happens inside the browser's media stack, which is the point - ADR 0003
// established that the failure this phase fixes is a background `.play()` on a
// freshly-loaded element, not a frozen main thread, so the fix is to never need a second
// one (see ticket 04). This hook still drives look-ahead TTS generation via
// /api/audio-chunks, which is what makes the playlist grow, and still persists the
// reading position; `initialIndex` lets a caller resume a Book where it was left off.
export function useBookPlayer({
  bookId,
  chunks,
  initialIndex = 0,
  initialSentenceIndex = 0,
  voice,
  speed = 1,
}) {
  const [chunkAudio, setChunkAudio] = useState({});
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [wantsToPlay, setWantsToPlay] = useState(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(initialSentenceIndex);
  const audioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());

  const currentStatus = chunkAudio[currentIndex]?.status;

  // Nothing derives the playing Sentence from the clock any more. A Sentence's stored
  // offsets are relative to its own Chunk, and this element's timeline now runs across
  // the whole Book, so mapping one onto the other would not merely lag - it would name
  // the wrong Sentence and then persist it as the Listener's saved place. Between this
  // ticket and ticket 05, which brings absolute cue times, the highlight and the saved
  // position move only when the Listener moves them.
  //
  // A chunk that failed to generate should not keep showing Pause with nothing
  // happening (a visible error/retry surfaces instead - see AudioPlayer/PlayerBar).
  const isPlaying = wantsToPlay && currentStatus !== 'error';

  const fetchChunk = useCallback(
    async (index) => {
      if (pendingFetchesRef.current.has(index)) return;
      pendingFetchesRef.current.add(index);
      setChunkAudio((prev) => ({ ...prev, [index]: { status: 'loading' } }));

      try {
        const response = await fetch('/api/audio-chunks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId, chunkIndex: index, text: chunks[index], voice }),
        });

        if (!response.ok) {
          throw new Error('Audio generation failed');
        }

        const data = await response.json();
        setChunkAudio((prev) => ({
          ...prev,
          [index]: { status: 'ready', url: data.url, boundaries: data.boundaries, voice },
        }));
      } catch {
        setChunkAudio((prev) => ({ ...prev, [index]: { status: 'error' } }));
      } finally {
        pendingFetchesRef.current.delete(index);
      }
    },
    [bookId, chunks, voice],
  );

  // Keep the look-ahead buffer topped up as playback position or chunk state changes.
  // A generated Chunk is a segment the playlist route can serve, so this is what makes
  // the playlist grow - it is no longer what feeds the <audio> element directly.
  useEffect(() => {
    if (chunks.length === 0) return;

    const statuses = Object.fromEntries(
      Object.entries(chunkAudio).map(([index, entry]) => [index, entry.status]),
    );
    const plan = chunkFetchPlan({
      totalChunks: chunks.length,
      currentIndex,
      lookahead: LOOKAHEAD,
      statuses,
    });

    plan.forEach((index) => fetchChunk(index));
  }, [chunks, currentIndex, chunkAudio, fetchChunk]);

  const src = playlistUrl(bookId, voice);
  // The only assignment to `src` in the codebase: once on mount, and again only when the
  // Book or voice changes. Re-pointing it reloads the element, which is why nothing else
  // is allowed to touch it - a reload mid-Book is exactly the interruption this phase
  // exists to remove. `speed` is a dependency only because loading a source resets
  // playbackRate, so the current speed has to be re-applied with each load; the guard
  // means a speed change on its own returns before touching anything.
  const loadedSrcRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || loadedSrcRef.current === src) return;

    loadedSrcRef.current = src;
    audio.src = src;
    audio.playbackRate = speed;
  }, [src, speed]);

  // Applied immediately, independent of the load above - a pure client-side effect, no
  // new TTS calls or cache changes (see phase 1.5 ticket 04).
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // The (Chunk, Sentence) pair most recently sent to the library, so the debounced
  // effect below can tell "already persisted by an explicit seekToSentence call" apart
  // from "still needs persisting" without a mutable trigger flag - starts at null so the
  // very first render always persists once (see phase 1.5 ticket 05).
  const lastPersistedRef = useRef(null);
  const persistTimeoutRef = useRef(null);

  // Persist the reading position - both Chunk and Sentence together, as one atomic pair
  // - so reopening this book later (see BookLibrary) resumes at the exact Sentence
  // rather than just the Chunk. A network call, so a failure is caught here -
  // fire-and-forget from the caller's perspective, since there's no UI for surfacing a
  // failed resume-position save.
  const persistResumePosition = useCallback(
    (chunkIndex, sentenceIndex) => {
      lastPersistedRef.current = { chunkIndex, sentenceIndex };
      updateResumeIndex(bookId, {
        resumeIndex: chunkIndex,
        resumeSentenceIndex: sentenceIndex,
      }).catch((error) => {
        console.error('Failed to persist resume position', error);
      });
    },
    [bookId],
  );

  // Debounced/coalesced (see RESUME_PERSIST_DEBOUNCE_MS) because natural playback
  // advances the active Sentence roughly every few seconds - an explicit Sentence click
  // (seekToSentence below) persists immediately instead, via persistResumePosition
  // directly, and updates lastPersistedRef synchronously so this effect's own later run
  // (once React actually applies that state change) finds nothing left to do.
  useEffect(() => {
    const last = lastPersistedRef.current;
    if (last && last.chunkIndex === currentIndex && last.sentenceIndex === activeSentenceIndex) {
      return undefined;
    }

    persistTimeoutRef.current = setTimeout(
      () => persistResumePosition(currentIndex, activeSentenceIndex),
      RESUME_PERSIST_DEBOUNCE_MS,
    );
    return () => clearTimeout(persistTimeoutRef.current);
  }, [currentIndex, activeSentenceIndex, persistResumePosition]);

  // The Listener's gesture is the only thing that ever starts playback: this call, from
  // the transport control or a MediaSession action. No effect, timer, or event handler
  // calls play() - that is the whole point of the single continuous source (ADR 0003).
  const play = useCallback(() => {
    setWantsToPlay(true);
    // Caught rather than left to reject unhandled: play() rejects with an AbortError if
    // the element is still loading the playlist when the Listener presses play, and the
    // foreground checkpoint below corrects the button back to Play on its own.
    audioRef.current?.play().catch((error) => {
      console.error('Playback could not start', error);
    });
  }, []);
  const pause = useCallback(() => {
    setWantsToPlay(false);
    audioRef.current?.pause();
  }, []);

  // The end of the Book, not the end of a Chunk: with one continuous source, `ended`
  // only fires once the playlist has an #EXT-X-ENDLIST and playback reaches it.
  const handleEnded = useCallback(() => setWantsToPlay(false), []);

  // A backgrounded tab can suspend or throttle media events without telling the page in
  // an orderly way, so React's `isPlaying` can drift from what the element actually did.
  // Correcting that flag is all this checkpoint has left to do: segment advancement is
  // the media stack's job now, and it never calls play() - a background play() is the
  // failure ADR 0003 identified, so retrying one here would reintroduce it. Stashed in a
  // ref (rather than read directly by the listener effect below) so that effect can
  // attach its listeners once on mount instead of re-subscribing on every state change
  // this closure reads.
  const reconcileOnForegroundRef = useRef(null);
  // The backgrounding-triggered counterpart: if the OS fully kills the tab's process
  // while hidden (rather than just suspending it), any pending debounced write in the
  // persistence effect above never gets to run. This flushes persistResumePosition
  // immediately instead of waiting for it (see phase 1.8 ticket 03). Same
  // ref-refreshed-every-commit trick, for the same reason.
  const flushOnHiddenRef = useRef(null);
  // Refs can't be written during render (only read) - this keeps the ref's closure
  // current after every commit instead, so the listener effect below still only has to
  // attach its listeners once.
  useEffect(() => {
    flushOnHiddenRef.current = () => {
      clearTimeout(persistTimeoutRef.current);
      const last = lastPersistedRef.current;
      if (last && last.chunkIndex === currentIndex && last.sentenceIndex === activeSentenceIndex) {
        return;
      }
      persistResumePosition(currentIndex, activeSentenceIndex);
    };
  });
  useEffect(() => {
    reconcileOnForegroundRef.current = () => {
      const audio = audioRef.current;
      if (!audio) return;

      let isPlayingCorrectedTo = null;
      if (audio.paused && wantsToPlay) {
        setWantsToPlay(false);
        isPlayingCorrectedTo = false;
      } else if (!audio.paused && !wantsToPlay) {
        setWantsToPlay(true);
        isPlayingCorrectedTo = true;
      }

      // TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js.
      logDiagnosticEvent('reconcile', {
        isPlayingCorrectedTo,
        audioPaused: audio.paused,
        audioCurrentTime: audio.currentTime,
      });
    };
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      // TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js.
      logDiagnosticEvent('visibilitychange', { visibilityState: document.visibilityState });
      if (document.visibilityState === 'visible') {
        reconcileOnForegroundRef.current?.();
      } else if (document.visibilityState === 'hidden') {
        flushOnHiddenRef.current?.();
      }
    };
    const handleFocus = () => {
      logDiagnosticEvent('focus');
      reconcileOnForegroundRef.current?.();
    };
    // A fallback for the case where a killed process doesn't get to fire
    // visibilitychange first - the same flush, reusing the same ref (see phase 1.8
    // ticket 03).
    const handlePageHide = () => {
      logDiagnosticEvent('pagehide');
      flushOnHiddenRef.current?.();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  // Selects where reading is, identified by a Chunk and its index within that Chunk's
  // Sentences - the click target for both the current Chunk's text and any other's,
  // generated or not (see phase 1.5 ticket 01). A Chunk that isn't ready yet is fetched
  // directly here, bypassing chunkFetchPlan's sequential look-ahead ordering, so seeking
  // ahead doesn't force generating every Chunk in between. Moving `audio.currentTime` to
  // the selected Sentence is deliberately not part of this: a Sentence's stored offset is
  // relative to its own Chunk, and writing that onto the Book-wide timeline would seek to
  // the wrong place. Ticket 05 restores the audio half from cue times, on the same
  // timeline the element actually plays.
  const seekToSentence = useCallback(
    (chunkIndex, sentenceIndex) => {
      // An explicit click always persists this reading position right away, bypassing
      // the debounce natural playback advance goes through (see phase 1.5 ticket 05).
      clearTimeout(persistTimeoutRef.current);
      persistResumePosition(chunkIndex, sentenceIndex);

      setActiveSentenceIndex(sentenceIndex);
      if (chunkAudio[chunkIndex]?.status !== 'ready') {
        fetchChunk(chunkIndex);
      }
      if (chunkIndex !== currentIndex) {
        setCurrentIndex(chunkIndex);
      }
    },
    [chunkAudio, currentIndex, fetchChunk, persistResumePosition],
  );

  return {
    audioRef,
    currentIndex,
    isPlaying,
    chunkAudio,
    activeSentenceIndex,
    play,
    pause,
    handleEnded,
    seekToSentence,
    retryChunk: fetchChunk,
  };
}
