'use client';

import { Box, Button, Text } from '@chakra-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiTarget } from 'react-icons/fi';

import { splitIntoSentences } from '@/app/_lib/chunkText';

import PronunciationReportForm from './PronunciationReportForm';
import ScrollPositionIndicator from './ScrollPositionIndicator';

// How long to leave auto-scroll suspended after the reader scrolls manually, before
// resuming to follow the active sentence again (see ticket 01).
const AUTO_SCROLL_RESUME_DELAY_MS = 4000;

// How much of the transcript container's content is scrollable - shared by both
// directions of the scrollTop <-> percentage conversion below.
function scrollableRange(container) {
  return container.scrollHeight - container.clientHeight;
}

// The transcript container's scroll position as a percentage - purely a function of its
// own scroll geometry, with no chunk index or audio duration data involved (see ticket 04).
function computeScrollPercent(container) {
  if (!container) return 0;
  const scrollable = scrollableRange(container);
  return scrollable > 0 ? (container.scrollTop / scrollable) * 100 : 0;
}

// Scrollable rendering of the whole book's text, sentence by sentence: highlights
// whichever sentence is currently playing (or queued to play next, once paused - see
// ticket 02), auto-scrolls to keep it visible, and reports clicks (chunkIndex,
// sentenceIndex) - including on a sentence in a chunk that hasn't been generated yet -
// via onSentenceClick, so the caller can drive seeking (see ticket 01). Sentence
// clicking is disabled while playing, so an accidental tap can't derail playback -
// scrolling itself is never affected either way (see ticket 02). Split out of
// AudioPlayer as its own component so it can scroll independently of the persistent
// PlayerBar (see ticket 07).
export default function TranscriptView({
  chunks,
  currentIndex,
  activeSentenceIndex,
  isPlaying,
  onSentenceClick,
  bookTitle,
}) {
  // Every chunk's raw text is already available client-side (it was chunked before any
  // audio was generated), so the whole book can be shown - and clicked into - up front,
  // independent of which chunks have been synthesized yet.
  const sentencesByChunk = useMemo(
    () => chunks.map((chunkOfText) => splitIntoSentences(chunkOfText)),
    [chunks],
  );

  const activeSentenceRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const suspendAutoScrollRef = useRef(false);
  const resumeAutoScrollTimeoutRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [selectedPhrase, setSelectedPhrase] = useState(null);

  const updateScrollPercent = useCallback(() => {
    setScrollPercent(computeScrollPercent(scrollContainerRef.current));
  }, []);

  // A scroll the reader triggered themselves (as opposed to our own scrollIntoView
  // below) suspends auto-scroll rather than fighting them, resuming after a short idle
  // period. The scroll-position indicator tracks every scroll regardless of source, so
  // it stays in sync during auto-scroll and "jump to now playing" too (see ticket 04).
  const handleManualScroll = useCallback(() => {
    updateScrollPercent();
    if (isProgrammaticScrollRef.current) return;

    suspendAutoScrollRef.current = true;
    clearTimeout(resumeAutoScrollTimeoutRef.current);
    resumeAutoScrollTimeoutRef.current = setTimeout(() => {
      suspendAutoScrollRef.current = false;
    }, AUTO_SCROLL_RESUME_DELAY_MS);
  }, [updateScrollPercent]);

  useEffect(() => {
    updateScrollPercent();
  }, [updateScrollPercent]);

  // The scroll-position indicator's drop target: sets the transcript's own scrollTop
  // directly from the target percentage. It never touches audio.currentTime or
  // chunk/sentence seeking - purely a text-scroll affordance (see ticket 04). Named
  // apart from "seek" (used elsewhere for audio/sentence seeking) so the two aren't
  // confused for one another.
  const handleScrollPercentChange = useCallback((percent) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollable = scrollableRange(container);
    container.scrollTop = scrollable > 0 ? (percent / 100) * scrollable : 0;
    setScrollPercent(percent);
  }, []);

  // Shared by both the auto-scroll effect below and the "jump to now playing" button
  // (see ticket 03) - the same scrollIntoView call, marked programmatic so it doesn't
  // itself trip handleManualScroll's suspension above.
  const scrollToActiveSentence = useCallback(() => {
    const node = activeSentenceRef.current;
    if (!node) return undefined;

    isProgrammaticScrollRef.current = true;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (suspendAutoScrollRef.current) return undefined;
    const clearFlag = scrollToActiveSentence();
    return () => clearTimeout(clearFlag);
  }, [currentIndex, activeSentenceIndex, scrollToActiveSentence]);

  useEffect(() => () => clearTimeout(resumeAutoScrollTimeoutRef.current), []);

  // Scrolls back to the active sentence on demand, regardless of whether auto-scroll is
  // currently suspended from a recent manual scroll (see ticket 03) - and re-arms
  // auto-follow immediately rather than leaving it suspended for the rest of the idle
  // window, since the reader just asked to be back at their listening position.
  const handleJumpToNowPlaying = useCallback(() => {
    suspendAutoScrollRef.current = false;
    clearTimeout(resumeAutoScrollTimeoutRef.current);
    scrollToActiveSentence();
  }, [scrollToActiveSentence]);

  // Native text selection (see ticket 10) - a non-empty selection surfaces the "report
  // pronunciation issue" affordance, pre-filled with the selected phrase.
  const handleTextSelection = useCallback(() => {
    const text = window.getSelection?.().toString().trim();
    if (text) setSelectedPhrase(text);
  }, []);

  return (
    <Box display="flex" flexDirection="column" flex="1" minH={0} w="full">
      <ScrollPositionIndicator
        percent={scrollPercent}
        onPercentChange={handleScrollPercentChange}
      />
      <Box position="relative" flex="1" minH={0} w="full">
        <Button
          aria-label="Jump to now playing"
          onClick={handleJumpToNowPlaying}
          position="absolute"
          bottom={4}
          right={4}
          zIndex={1}
          size="sm"
          borderRadius="full"
        >
          <FiTarget />
        </Button>
        {selectedPhrase && (
          <PronunciationReportForm
            key={selectedPhrase}
            phrase={selectedPhrase}
            bookTitle={bookTitle}
            onDismiss={() => setSelectedPhrase(null)}
          />
        )}
        <Box
          ref={scrollContainerRef}
          onScroll={handleManualScroll}
          onMouseUp={handleTextSelection}
          onTouchEnd={handleTextSelection}
          h="full"
          w="full"
          overflowY="auto"
          role="log"
          aria-label="Book text"
        >
          {chunks.map((_, chunkIndex) => (
            <Text as="p" key={chunkIndex} mb={2}>
              {sentencesByChunk[chunkIndex].map((sentence, sentenceIndex) => {
                const isActive =
                  chunkIndex === currentIndex && sentenceIndex === activeSentenceIndex;

                return (
                  <Text
                    as="span"
                    key={sentenceIndex}
                    ref={isActive ? activeSentenceRef : undefined}
                    data-testid={`sentence-${chunkIndex}-${sentenceIndex}`}
                    data-active={isActive ? 'true' : undefined}
                    bg={isActive ? 'activeSentenceBg' : undefined}
                    color={isActive ? 'activeSentenceFg' : undefined}
                    cursor={isPlaying ? 'default' : 'pointer'}
                    onClick={
                      isPlaying ? undefined : () => onSentenceClick(chunkIndex, sentenceIndex)
                    }
                  >
                    {sentence}
                  </Text>
                );
              })}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
