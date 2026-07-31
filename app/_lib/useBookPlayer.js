'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { updateResumeIndex } from './bookLibrary';
import { chunkFetchPlan } from './chunkFetchPlan';
import { deriveSentenceSpans } from './sentenceSpans';

const LOOKAHEAD = 2;
// Natural playback can advance the active sentence roughly every few seconds - this
// coalesces those persistence writes into one trailing call instead of a network
// request on every single sentence boundary (see ticket 05).
const RESUME_PERSIST_DEBOUNCE_MS = 400;

// Assigns a chunk's audio into a physical <audio> element and stamps which chunk index
// it now holds - shared by the standby-preload effect and the active element's
// cold-load path below so both stay in sync (see ticket 05).
function loadAudioInto(audio, loadedIndexRef, index, url, speed) {
  audio.src = url;
  audio.playbackRate = speed;
  loadedIndexRef.current = index;
}

// Which sentence span a given playback time falls in, or null if it's before the first
// span's start (nothing to highlight yet). Shared by natural-playback timeupdate
// tracking and the foreground-resync reconciliation below (see Phase 1.8 ticket 01) so
// there's one place that maps currentTime to a Sentence index, not two.
function findActiveSentenceIndex(spans, time) {
  if (spans.length === 0) return null;
  const index = spans.findIndex((span) => time >= span.startSeconds && time < span.endSeconds);
  if (index !== -1) return index;
  if (time >= spans.at(-1).endSeconds) return spans.length - 1;
  return null;
}

// Drives progressive, sequential playback of a book's chunks: fetches a small
// look-ahead window of upcoming chunks in the background (via /api/audio-chunks)
// while the current one plays, and advances to the next chunk when the current
// one finishes. Callers attach `primaryAudioRef`/`secondaryAudioRef` to a pair of
// <audio> elements and both elements' `onEnded`/`onTimeUpdate` to `handleEnded`/
// `handleTimeUpdate` - `activeIsPrimary` says which one is currently playing (see
// ticket 05, the ping-pong preloading below). `initialIndex` lets a caller resume a
// book at a previously-saved position (see ticket 07); the current chunk index is
// kept persisted back to the library as the resume position.
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
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  // Which physical <audio> element is the "active" (playing) one vs. the "standby"
  // (preloading) one - flips on each natural chunk advance whose next chunk was
  // already buffered ahead of time, rather than either element having a fixed role
  // (see ticket 05).
  const [activeIsPrimary, setActiveIsPrimary] = useState(true);
  const primaryAudioRef = useRef(null);
  const secondaryAudioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());
  // Which chunk index (if any) is currently loaded (src assigned) into each physical
  // element, tracked per element rather than per role so a role flip doesn't require
  // copying values between refs - only the active/standby labels below move.
  const primaryLoadedIndexRef = useRef(null);
  const secondaryLoadedIndexRef = useRef(null);
  // A cross-chunk jump-to-sentence request, applied once its target chunk's audio
  // finishes loading (see the "load and play" effect below). Primed with the saved
  // (initialIndex, initialSentenceIndex) pair on mount rather than starting null, so
  // pressing play for the first time resumes at the exact saved Sentence instead of the
  // start of its Chunk - reusing the same seek-once-ready mechanism a Sentence click
  // uses, rather than a separate resume path (see ticket 05). A no-op when
  // initialSentenceIndex is 0: audio.currentTime already starts there on its own.
  const pendingSeekRef = useRef(
    initialSentenceIndex > 0
      ? { chunkIndex: initialIndex, sentenceIndex: initialSentenceIndex }
      : null,
  );
  // The chunk index a seek was just applied to, so the chunk-change reset effect below
  // doesn't clobber it back to sentence 0. Needed specifically when a jump's target chunk
  // is already ready: the load-and-play effect (declared above the reset effect, so it
  // runs first within the same commit) applies the seek and clears pendingSeekRef in the
  // same flush the reset effect also reacts to `currentIndex` in - without this ref, the
  // reset effect would see pendingSeekRef already cleared and undo the seek it just missed.
  const seekAppliedIndexRef = useRef(null);

  const activeAudioRef = activeIsPrimary ? primaryAudioRef : secondaryAudioRef;
  const standbyAudioRef = activeIsPrimary ? secondaryAudioRef : primaryAudioRef;
  const activeLoadedIndexRef = activeIsPrimary ? primaryLoadedIndexRef : secondaryLoadedIndexRef;
  const standbyLoadedIndexRef = activeIsPrimary ? secondaryLoadedIndexRef : primaryLoadedIndexRef;

  const currentStatus = chunkAudio[currentIndex]?.status;
  const currentUrl = chunkAudio[currentIndex]?.url;
  const nextIndex = currentIndex + 1;
  const nextStatus = chunkAudio[nextIndex]?.status;
  const nextUrl = chunkAudio[nextIndex]?.url;

  // Sentence-level spans for the currently-loaded chunk, derived from its word-boundary
  // metadata - a pure re-derivation from cached data, not persisted state (see ticket 01).
  const currentSentenceSpans = useMemo(() => {
    if (currentStatus !== 'ready') return [];
    return deriveSentenceSpans({
      text: chunks[currentIndex],
      boundaries: chunkAudio[currentIndex]?.boundaries ?? [],
    });
  }, [chunkAudio, currentIndex, chunks, currentStatus]);
  // A look-ahead chunk that already failed before its turn arrived should not
  // keep showing Pause with nothing happening (a visible error/retry surfaces
  // instead - see AudioPlayer/PlayerBar).
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

  // As soon as the next chunk's audio is known (its metadata, including the blob URL,
  // is already prefetched by the look-ahead above), start loading its actual audio
  // bytes into the standby element in the background - independent of whether the
  // current chunk is playing or paused, so it's ready the moment playback reaches it
  // (see ticket 05). A no-op once the standby element already holds this same chunk.
  useEffect(() => {
    const standbyAudio = standbyAudioRef.current;
    if (!standbyAudio) return;
    if (nextIndex >= chunks.length) return;
    if (nextStatus !== 'ready') return;
    if (standbyLoadedIndexRef.current === nextIndex) return;

    loadAudioInto(standbyAudio, standbyLoadedIndexRef, nextIndex, nextUrl, speed);
  }, [
    nextIndex,
    nextStatus,
    nextUrl,
    chunks.length,
    speed,
    standbyAudioRef,
    standbyLoadedIndexRef,
  ]);

  // Shared by both seek paths below (same-chunk direct seek, and the cross-chunk
  // pending-seek applied once loading finishes) so there's one place that sets
  // audio.currentTime and the active-sentence highlight together.
  const applySeek = useCallback(
    (spans, sentenceIndex, chunkIndex) => {
      const audio = activeAudioRef.current;
      const target = spans[sentenceIndex];
      if (!audio || !target) return;
      audio.currentTime = target.startSeconds;
      setActiveSentenceIndex(sentenceIndex);
      setCurrentTimeSeconds(target.startSeconds);
      seekAppliedIndexRef.current = chunkIndex;
    },
    [activeAudioRef],
  );

  // Only the active element is ever supposed to be audible - the standby element exists
  // purely to preload the next chunk's bytes and never has .play() called on it. Called
  // both as a backstop (the foreground-resync reconciliation below, in case something
  // already went wrong while the tab was hidden) and right after every .play() call this
  // hook makes (in case a stale .play() promise from before backgrounding resolves late),
  // so overlapping audio from the ping-pong pair is a blanket invariant rather than a fix
  // targeted at one specific race (see Phase 1.8 ticket 01).
  const enforceSingleActiveAudio = useCallback(() => {
    const standby = standbyAudioRef.current;
    if (standby && !standby.paused) {
      standby.pause();
    }
  }, [standbyAudioRef]);

  // Once the current chunk's audio is ready and playback is desired, load and play it
  // on the active element. A jump-to-sentence request targeting this chunk (see
  // seekToSentence) is applied here, once its audio has actually finished loading
  // rather than optimistically beforehand. When the active element already holds this
  // chunk's audio - either because it was already playing, or because a natural
  // advance just swapped in an already-buffered standby element (see handleEnded below)
  // - this only resumes playback, without a fresh (and gap-inducing) src assignment.
  useEffect(() => {
    const audio = activeAudioRef.current;
    if (!audio || !isPlaying || currentStatus !== 'ready') return;

    if (activeLoadedIndexRef.current !== currentIndex) {
      loadAudioInto(audio, activeLoadedIndexRef, currentIndex, currentUrl, speed);

      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek?.chunkIndex === currentIndex) {
        applySeek(currentSentenceSpans, pendingSeek.sentenceIndex, currentIndex);
        pendingSeekRef.current = null;
      }

      audio.play();
      enforceSingleActiveAudio();
    } else if (audio.paused) {
      audio.play();
      enforceSingleActiveAudio();
    }
  }, [
    isPlaying,
    currentIndex,
    currentStatus,
    currentUrl,
    currentSentenceSpans,
    applySeek,
    speed,
    activeAudioRef,
    activeLoadedIndexRef,
    enforceSingleActiveAudio,
  ]);

  // Applied immediately to both elements, independent of the chunk-load effect above
  // (which only runs when the chunk itself changes) - a pure client-side effect, no new
  // TTS calls or cache changes (see ticket 04). Covers both elements (not just the
  // active one) so a chunk already preloaded into the standby element carries the
  // current speed too, once it becomes active (see ticket 05).
  useEffect(() => {
    if (primaryAudioRef.current) primaryAudioRef.current.playbackRate = speed;
    if (secondaryAudioRef.current) secondaryAudioRef.current.playbackRate = speed;
  }, [speed]);

  // The (Chunk, Sentence) pair most recently sent to the library, so the debounced
  // effect below can tell "already persisted by an explicit seekToSentence call" apart
  // from "still needs persisting" without a mutable trigger flag - starts at null so the
  // very first render always persists once (see ticket 05).
  const lastPersistedRef = useRef(null);
  const persistTimeoutRef = useRef(null);

  // Persist the reading position - both Chunk and Sentence together, as one atomic pair
  // - so reopening this book later (see BookLibrary) resumes at the exact Sentence
  // rather than just the Chunk. A network call, so a failure is caught here -
  // fire-and-forget from the caller's perspective, since there's no UI in this ticket's
  // scope for surfacing a failed resume-position save.
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

  // A chunk change (natural advance or a cross-chunk jump) starts its sentence
  // highlight at the top; timeupdate corrects it once playback is under way. Skipped
  // when a jump-to-sentence targeting this same chunk is still pending (not yet ready,
  // see the load-and-play effect above) or was just applied to it in this same effect
  // flush (already ready when the jump was requested) - either way, this reset would
  // otherwise clobber it back to 0.
  useEffect(() => {
    if (pendingSeekRef.current?.chunkIndex === currentIndex) return;
    if (seekAppliedIndexRef.current === currentIndex) {
      seekAppliedIndexRef.current = null;
      return;
    }
    setActiveSentenceIndex(0);
    setCurrentTimeSeconds(0);
  }, [currentIndex]);

  // Advances to the next chunk. If its audio was already buffered into the standby
  // element by the preload effect above, ping-pongs the active/standby roles so the
  // "load and play" effect just resumes the already-buffered element instead of
  // assigning a cold src and waiting on a fresh load (see ticket 05) - otherwise it
  // falls back to that same cold-load path once the chunk's audio becomes ready,
  // unchanged from before this ticket.
  const handleEnded = useCallback(() => {
    if (currentIndex + 1 >= chunks.length) {
      setWantsToPlay(false);
      return;
    }

    if (standbyLoadedIndexRef.current === currentIndex + 1) {
      setActiveIsPrimary((prev) => !prev);
    }

    setCurrentIndex(currentIndex + 1);
  }, [currentIndex, chunks.length, standbyLoadedIndexRef]);

  const play = useCallback(() => setWantsToPlay(true), []);
  const pause = useCallback(() => {
    setWantsToPlay(false);
    activeAudioRef.current?.pause();
  }, [activeAudioRef]);

  // Finds which derived sentence span contains the audio element's current playback
  // time, so the active-sentence highlight tracks natural playback without a separate
  // polling timer.
  const handleTimeUpdate = useCallback(() => {
    const audio = activeAudioRef.current;
    if (!audio) return;
    setCurrentTimeSeconds(audio.currentTime);

    const index = findActiveSentenceIndex(currentSentenceSpans, audio.currentTime);
    if (index !== null) {
      setActiveSentenceIndex(index);
    }
  }, [currentSentenceSpans, activeAudioRef]);

  // A backgrounded tab can suspend/throttle timeupdate and ended events without telling
  // the page in an orderly way, so React state (isPlaying, activeSentenceIndex,
  // currentIndex) can silently drift from what the real <audio> element did. This is the
  // single checkpoint that reconciles the two on return to foreground, treating the
  // element as ground truth rather than trusting whatever state was left over from
  // before backgrounding (see Phase 1.8 ticket 01). Stashed in a ref (rather than read
  // directly by the listener effect below) so that effect can attach its listeners once
  // on mount instead of re-subscribing on every state change this closure reads.
  const reconcileOnForegroundRef = useRef(null);
  // Refs can't be written during render (only read) - this keeps the ref's closure
  // current after every commit instead, so the listener effect below still only has to
  // attach its listeners once.
  useEffect(() => {
    reconcileOnForegroundRef.current = () => {
      const audio = activeAudioRef.current;
      if (!audio) return;

      // The element finished a chunk while hidden and never got to (or never processed)
      // its ended event - advance via the same path a live ended event already takes,
      // rather than a second chunk-advance mechanism.
      if (audio.ended && currentIndex + 1 < chunks.length) {
        handleEnded();
        enforceSingleActiveAudio();
        return;
      }

      if (audio.paused && wantsToPlay) {
        setWantsToPlay(false);
      } else if (!audio.paused && !wantsToPlay) {
        setWantsToPlay(true);
      }

      const index = findActiveSentenceIndex(currentSentenceSpans, audio.currentTime);
      if (index !== null && index !== activeSentenceIndex) {
        setActiveSentenceIndex(index);
      }

      enforceSingleActiveAudio();
    };
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconcileOnForegroundRef.current?.();
      }
    };
    const handleFocus = () => {
      reconcileOnForegroundRef.current?.();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Sets where the _next_ play will start, identified by a chunk and its index within
  // that chunk's derived sentence spans - the click target for both the current chunk's
  // text and any other chunk's, generated or not (see ticket 01). Does not itself start
  // playback (see ticket 02) - pressing play afterwards is what begins it, once the
  // target chunk is ready (see the "load and play" effect above). A chunk that isn't
  // ready yet is fetched directly here, bypassing chunkFetchPlan's sequential look-ahead
  // ordering, so seeking ahead doesn't force generating every chunk in between. An
  // explicit jump like this always loads onto the active element directly (unlike a
  // natural advance, it never ping-pongs to a preloaded standby - see ticket 05).
  const seekToSentence = useCallback(
    (chunkIndex, sentenceIndex) => {
      const entry = chunkAudio[chunkIndex];
      // An explicit click always persists this reading position right away, bypassing
      // the debounce natural playback advance goes through (see ticket 05).
      clearTimeout(persistTimeoutRef.current);
      persistResumePosition(chunkIndex, sentenceIndex);
      // "Already loaded" means the active <audio> element's src already points at this
      // chunk (playback of it has started at least once) - not merely that its audio is
      // ready, since assigning a fresh src (done by the load-and-play effect below)
      // resets playback position and would otherwise silently undo a seek applied here.
      const alreadyLoaded =
        chunkIndex === currentIndex && activeLoadedIndexRef.current === currentIndex;

      if (alreadyLoaded && entry?.status === 'ready') {
        pendingSeekRef.current = null;
        applySeek(currentSentenceSpans, sentenceIndex, currentIndex);
        return;
      }

      // The target chunk's audio isn't loaded into the active element yet, so its
      // exact start-of-sentence offset can't be applied to `audio.currentTime` here -
      // that happens once pendingSeekRef is picked up by the "load and play" effect.
      // The active-sentence highlight updates immediately regardless, so the Listener
      // sees what's queued to play next (see ticket 02, story 7).
      pendingSeekRef.current = { chunkIndex, sentenceIndex };
      setActiveSentenceIndex(sentenceIndex);
      if (entry?.status !== 'ready') {
        fetchChunk(chunkIndex);
      }
      if (chunkIndex !== currentIndex) {
        setCurrentIndex(chunkIndex);
      }
    },
    [
      chunkAudio,
      currentIndex,
      currentSentenceSpans,
      applySeek,
      fetchChunk,
      activeLoadedIndexRef,
      persistResumePosition,
    ],
  );

  return {
    primaryAudioRef,
    secondaryAudioRef,
    activeIsPrimary,
    currentIndex,
    isPlaying,
    chunkAudio,
    activeSentenceIndex,
    play,
    pause,
    handleEnded,
    handleTimeUpdate,
    seekToSentence,
    retryChunk: fetchChunk,
  };
}
