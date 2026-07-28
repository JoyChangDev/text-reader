'use client';

import { Box, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { splitIntoSentences } from '@/app/_lib/chunkText';

// How long to leave auto-scroll suspended after the reader scrolls manually, before
// resuming to follow the active sentence again (see ticket 01).
const AUTO_SCROLL_RESUME_DELAY_MS = 4000;

// Scrollable rendering of the whole book's text, sentence by sentence: highlights
// whichever sentence is currently playing, auto-scrolls to keep it visible, and
// reports clicks (chunkIndex, sentenceIndex) - including on a sentence in a chunk
// that hasn't been generated yet - via onSentenceClick, so the caller can drive
// seeking (see ticket 01). Split out of AudioPlayer as its own component so it can
// scroll independently of the persistent PlayerBar (see ticket 07).
export default function TranscriptView({
  chunks,
  currentIndex,
  activeSentenceIndex,
  onSentenceClick,
}) {
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
    <Box
      onScroll={handleManualScroll}
      flex="1"
      minH={0}
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
                onClick={() => onSentenceClick(chunkIndex, sentenceIndex)}
              >
                {sentence}
              </Text>
            );
          })}
        </Text>
      ))}
    </Box>
  );
}
