'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { updateResumeIndex } from './bookLibrary';
import { chunkFetchPlan } from './chunkFetchPlan';
import { deriveSentenceSpans } from './sentenceSpans';

const LOOKAHEAD = 2;

// Drives progressive, sequential playback of a book's chunks: fetches a small
// look-ahead window of upcoming chunks in the background (via /api/audio-chunks)
// while the current one plays, and advances to the next chunk when the current
// one finishes. Callers attach `audioRef` to a single <audio> element and its
// `onEnded` to `handleEnded`. `initialIndex` lets a caller resume a book at a
// previously-saved position (see ticket 07); the current chunk index is kept
// persisted back to the library as the resume position.
export function useBookPlayer({ bookId, chunks, initialIndex = 0, voice, speed = 1 }) {
  const [chunkAudio, setChunkAudio] = useState({});
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [wantsToPlay, setWantsToPlay] = useState(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const audioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());
  const loadedIndexRef = useRef(null);
  // A cross-chunk jump-to-sentence request, applied once its target chunk's audio
  // finishes loading (see the "load and play" effect below).
  const pendingSeekRef = useRef(null);
  // The chunk index a seek was just applied to, so the chunk-change reset effect below
  // doesn't clobber it back to sentence 0. Needed specifically when a jump's target chunk
  // is already ready: the load-and-play effect (declared above the reset effect, so it
  // runs first within the same commit) applies the seek and clears pendingSeekRef in the
  // same flush the reset effect also reacts to `currentIndex` in - without this ref, the
  // reset effect would see pendingSeekRef already cleared and undo the seek it just missed.
  const seekAppliedIndexRef = useRef(null);

  const currentStatus = chunkAudio[currentIndex]?.status;
  const currentUrl = chunkAudio[currentIndex]?.url;

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

  // Shared by both seek paths below (same-chunk direct seek, and the cross-chunk
  // pending-seek applied once loading finishes) so there's one place that sets
  // audio.currentTime and the active-sentence highlight together.
  const applySeek = useCallback((spans, sentenceIndex, chunkIndex) => {
    const audio = audioRef.current;
    const target = spans[sentenceIndex];
    if (!audio || !target) return;
    audio.currentTime = target.startSeconds;
    setActiveSentenceIndex(sentenceIndex);
    setCurrentTimeSeconds(target.startSeconds);
    seekAppliedIndexRef.current = chunkIndex;
  }, []);

  // Once the current chunk's audio is ready and playback is desired, load and play it.
  // A jump-to-sentence request targeting this chunk (see seekToSentence) is applied here,
  // once its audio has actually finished loading rather than optimistically beforehand.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || currentStatus !== 'ready') return;

    if (loadedIndexRef.current !== currentIndex) {
      audio.src = currentUrl;
      audio.playbackRate = speed;
      loadedIndexRef.current = currentIndex;

      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek?.chunkIndex === currentIndex) {
        applySeek(currentSentenceSpans, pendingSeek.sentenceIndex, currentIndex);
        pendingSeekRef.current = null;
      }

      audio.play();
    } else if (audio.paused) {
      audio.play();
    }
  }, [isPlaying, currentIndex, currentStatus, currentUrl, currentSentenceSpans, applySeek, speed]);

  // Applied immediately to whatever's currently loaded, independent of the chunk-load
  // effect above (which only runs when the chunk itself changes) - a pure client-side
  // effect, no new TTS calls or cache changes (see ticket 04).
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  // Persist the reading position as it advances, so reopening this book later
  // (see BookLibrary) resumes here rather than from the start.
  useEffect(() => {
    updateResumeIndex(bookId, currentIndex);
  }, [bookId, currentIndex]);

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

  const handleEnded = useCallback(() => {
    if (currentIndex + 1 >= chunks.length) {
      setWantsToPlay(false);
      return;
    }
    setCurrentIndex(currentIndex + 1);
  }, [currentIndex, chunks.length]);

  const play = useCallback(() => setWantsToPlay(true), []);
  const pause = useCallback(() => {
    setWantsToPlay(false);
    audioRef.current?.pause();
  }, []);

  // Finds which derived sentence span contains the audio element's current playback
  // time, so the active-sentence highlight tracks natural playback without a separate
  // polling timer.
  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTimeSeconds(audio.currentTime);

    if (currentSentenceSpans.length === 0) return;

    const time = audio.currentTime;
    const index = currentSentenceSpans.findIndex(
      (span) => time >= span.startSeconds && time < span.endSeconds,
    );
    if (index !== -1) {
      setActiveSentenceIndex(index);
    } else if (time >= currentSentenceSpans.at(-1).endSeconds) {
      setActiveSentenceIndex(currentSentenceSpans.length - 1);
    }
  }, [currentSentenceSpans]);

  // Sets where the _next_ play will start, identified by a chunk and its index within
  // that chunk's derived sentence spans - the click target for both the current chunk's
  // text and any other chunk's, generated or not (see ticket 01). Does not itself start
  // playback (see ticket 02) - pressing play afterwards is what begins it, once the
  // target chunk is ready (see the "load and play" effect above). A chunk that isn't
  // ready yet is fetched directly here, bypassing chunkFetchPlan's sequential look-ahead
  // ordering, so seeking ahead doesn't force generating every chunk in between.
  const seekToSentence = useCallback(
    (chunkIndex, sentenceIndex) => {
      const entry = chunkAudio[chunkIndex];
      // "Already loaded" means the <audio> element's src already points at this chunk
      // (playback of it has started at least once) - not merely that its audio is ready,
      // since assigning a fresh src (done by the load-and-play effect below) resets
      // playback position and would otherwise silently undo a seek applied here first.
      const alreadyLoaded = chunkIndex === currentIndex && loadedIndexRef.current === currentIndex;

      if (alreadyLoaded && entry?.status === 'ready') {
        pendingSeekRef.current = null;
        applySeek(currentSentenceSpans, sentenceIndex, currentIndex);
        return;
      }

      // The target chunk's audio isn't loaded into the <audio> element yet, so its
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
    [chunkAudio, currentIndex, currentSentenceSpans, applySeek, fetchChunk],
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
    handleTimeUpdate,
    seekToSentence,
    retryChunk: fetchChunk,
  };
}
