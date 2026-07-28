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
export function useBookPlayer({ bookId, chunks, initialIndex = 0, voice }) {
  const [chunkAudio, setChunkAudio] = useState({});
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [wantsToPlay, setWantsToPlay] = useState(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(0);
  const audioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());
  const loadedIndexRef = useRef(null);
  // A cross-chunk jump-to-sentence request, applied once its target chunk's audio
  // finishes loading (see the "load and play" effect below).
  const pendingSeekRef = useRef(null);

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
  // keep showing Pause with nothing happening (a visible error/retry is
  // ticket 08's job, not this one's - this just avoids misleading the reader).
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
          [index]: { status: 'ready', url: data.url, boundaries: data.boundaries },
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
  const applySeek = useCallback((spans, sentenceIndex) => {
    const audio = audioRef.current;
    const target = spans[sentenceIndex];
    if (!audio || !target) return;
    audio.currentTime = target.startSeconds;
    setActiveSentenceIndex(sentenceIndex);
  }, []);

  // Once the current chunk's audio is ready and playback is desired, load and play it.
  // A jump-to-sentence request targeting this chunk (see seekToSentence) is applied here,
  // once its audio has actually finished loading rather than optimistically beforehand.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || currentStatus !== 'ready') return;

    if (loadedIndexRef.current !== currentIndex) {
      audio.src = currentUrl;
      loadedIndexRef.current = currentIndex;

      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek?.chunkIndex === currentIndex) {
        applySeek(currentSentenceSpans, pendingSeek.sentenceIndex);
        pendingSeekRef.current = null;
      }

      audio.play();
    } else if (audio.paused) {
      audio.play();
    }
  }, [isPlaying, currentIndex, currentStatus, currentUrl, currentSentenceSpans, applySeek]);

  // Persist the reading position as it advances, so reopening this book later
  // (see BookLibrary) resumes here rather than from the start.
  useEffect(() => {
    updateResumeIndex(bookId, currentIndex);
  }, [bookId, currentIndex]);

  // A chunk change (natural advance or a cross-chunk jump) starts its sentence
  // highlight at the top; timeupdate corrects it once playback is under way. Skipped
  // when a jump-to-sentence targeting this same chunk is still pending, so it doesn't
  // get clobbered back to 0 before (or after) the load-and-play effect above applies it.
  useEffect(() => {
    if (pendingSeekRef.current?.chunkIndex === currentIndex) return;
    setActiveSentenceIndex(0);
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
    if (!audio || currentSentenceSpans.length === 0) return;

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

  // Jumps playback to a specific sentence, identified by its chunk and its index within
  // that chunk's derived sentence spans - the click target for both the current chunk's
  // text and any other chunk's, generated or not (see ticket 01). A chunk that isn't
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
        applySeek(currentSentenceSpans, sentenceIndex);
        setWantsToPlay(true);
        return;
      }

      pendingSeekRef.current = { chunkIndex, sentenceIndex };
      setWantsToPlay(true);
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
