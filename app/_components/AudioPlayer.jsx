'use client';

import { Box, Button, HStack, NativeSelect, Text, VStack } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { splitIntoSentences } from '@/app/_lib/chunkText';
import {
  AVAILABLE_VOICES,
  getListenerSettings,
  updateListenerSettings,
} from '@/app/_lib/listenerSettings';
import { useBookPlayer } from '@/app/_lib/useBookPlayer';

// How long to leave auto-scroll suspended after the reader scrolls manually, before
// resuming to follow the active sentence again (see ticket 01).
const AUTO_SCROLL_RESUME_DELAY_MS = 4000;

// Sequential chunk player: plays one chunk at a time while a small look-ahead
// buffer of upcoming chunks generates in the background (see useBookPlayer). Renders
// the whole book's text, sentence by sentence, highlighting and auto-scrolling to
// whichever sentence is currently playing; clicking any sentence - including one in a
// chunk that hasn't been generated yet - seeks playback there directly.
export default function AudioPlayer({ bookId, chunks, initialIndex = 0, onBackToLibrary }) {
  const [voice, setVoice] = useState(() => getListenerSettings().voice);
  const {
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
    retryChunk,
  } = useBookPlayer({ bookId, chunks, initialIndex, voice });

  // Prospective only: this only affects chunks fetched from here on - chunks already
  // cached/generated under the previous voice keep playing as-is (see ticket 02).
  const handleVoiceChange = useCallback((event) => {
    const nextVoice = event.target.value;
    setVoice(nextVoice);
    updateListenerSettings({ voice: nextVoice });
  }, []);

  const currentChunkStatus = chunkAudio[currentIndex]?.status;
  const currentChunkReady = currentChunkStatus === 'ready';
  const currentChunkErrored = currentChunkStatus === 'error';

  // Every chunk's raw text is already available client-side (it was chunked before any
  // audio was generated), so the whole book can be shown - and clicked into - up front,
  // independent of which chunks have been synthesized yet.
  const sentencesByChunk = useMemo(
    () => chunks.map((chunkOfText) => splitIntoSentences(chunkOfText)),
    [chunks],
  );

  const activeSentenceRef = useRef(null);
  const suspendAutoScrollRef = useRef(false);
  const resumeAutoScrollTimeoutRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);

  // A scroll the reader triggered themselves (as opposed to our own scrollIntoView
  // below) suspends auto-scroll rather than fighting them, resuming after a short idle
  // period.
  const handleManualScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;

    suspendAutoScrollRef.current = true;
    clearTimeout(resumeAutoScrollTimeoutRef.current);
    resumeAutoScrollTimeoutRef.current = setTimeout(() => {
      suspendAutoScrollRef.current = false;
    }, AUTO_SCROLL_RESUME_DELAY_MS);
  }, []);

  useEffect(() => {
    if (suspendAutoScrollRef.current) return;
    const node = activeSentenceRef.current;
    if (!node) return;

    isProgrammaticScrollRef.current = true;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const clearFlag = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 0);

    return () => clearTimeout(clearFlag);
  }, [currentIndex, activeSentenceIndex]);

  useEffect(() => () => clearTimeout(resumeAutoScrollTimeoutRef.current), []);

  return (
    <VStack bg="background" color="foreground" align="start" gap={2}>
      <Button variant="plain" onClick={onBackToLibrary}>
        Back to library
      </Button>
      <Text>
        Chunk {currentIndex + 1} of {chunks.length}
      </Text>
      <Box
        onScroll={handleManualScroll}
        maxH="60vh"
        w="full"
        overflowY="auto"
        role="log"
        aria-label="Book text"
      >
        {chunks.map((_, chunkIndex) => (
          <Text as="p" key={chunkIndex} mb={2}>
            {sentencesByChunk[chunkIndex].map((sentence, sentenceIndex) => {
              const isActive = chunkIndex === currentIndex && sentenceIndex === activeSentenceIndex;

              return (
                <Text
                  as="span"
                  key={sentenceIndex}
                  ref={isActive ? activeSentenceRef : undefined}
                  data-testid={`sentence-${chunkIndex}-${sentenceIndex}`}
                  data-active={isActive ? 'true' : undefined}
                  bg={isActive ? 'activeSentenceBg' : undefined}
                  color={isActive ? 'activeSentenceFg' : undefined}
                  cursor="pointer"
                  onClick={() => seekToSentence(chunkIndex, sentenceIndex)}
                >
                  {sentence}
                </Text>
              );
            })}
          </Text>
        ))}
      </Box>
      <HStack>
        {isPlaying ? (
          <Button onClick={pause}>Pause</Button>
        ) : currentChunkErrored ? (
          <Button onClick={() => retryChunk(currentIndex)}>Retry</Button>
        ) : (
          <Button onClick={play} disabled={!currentChunkReady}>
            Play
          </Button>
        )}
        <NativeSelect.Root width="auto">
          <NativeSelect.Field
            aria-label="Narration voice"
            value={voice}
            onChange={handleVoiceChange}
          >
            {AVAILABLE_VOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>
      {currentChunkErrored && (
        <Text color="danger" role="alert">
          Couldn&apos;t generate audio for this chunk.
        </Text>
      )}
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        data-testid="audio-element"
      />
    </VStack>
  );
}
