'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { chunkFetchPlan } from './chunkFetchPlan';

const LOOKAHEAD = 2;

// Drives progressive, sequential playback of a book's chunks: fetches a small
// look-ahead window of upcoming chunks in the background (via /api/audio-chunks)
// while the current one plays, and advances to the next chunk when the current
// one finishes. Callers attach `audioRef` to a single <audio> element and its
// `onEnded` to `handleEnded`.
export function useBookPlayer({ bookId, chunks }) {
  const [chunkAudio, setChunkAudio] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wantsToPlay, setWantsToPlay] = useState(false);
  const audioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());
  const loadedIndexRef = useRef(null);

  const currentStatus = chunkAudio[currentIndex]?.status;
  const currentUrl = chunkAudio[currentIndex]?.url;
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
          body: JSON.stringify({ bookId, chunkIndex: index, text: chunks[index] }),
        });

        if (!response.ok) {
          throw new Error('Audio generation failed');
        }

        const data = await response.json();
        setChunkAudio((prev) => ({ ...prev, [index]: { status: 'ready', url: data.url } }));
      } catch {
        setChunkAudio((prev) => ({ ...prev, [index]: { status: 'error' } }));
      } finally {
        pendingFetchesRef.current.delete(index);
      }
    },
    [bookId, chunks],
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

  // Once the current chunk's audio is ready and playback is desired, load and play it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || currentStatus !== 'ready') return;

    if (loadedIndexRef.current !== currentIndex) {
      audio.src = currentUrl;
      loadedIndexRef.current = currentIndex;
      audio.play();
    } else if (audio.paused) {
      audio.play();
    }
  }, [isPlaying, currentIndex, currentStatus, currentUrl]);

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

  return {
    audioRef,
    currentIndex,
    isPlaying,
    chunkAudio,
    play,
    pause,
    handleEnded,
  };
}
