'use client';

import { Box, Text } from '@chakra-ui/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { splitIntoSentences } from '@/app/_lib/chunkText';
import { computeScrollPercent, scrollableRange } from '@/app/_lib/scrollPercent';

import PronunciationReportForm from './PronunciationReportForm';

// How long to leave auto-scroll suspended after the reader scrolls manually, before
// resuming to follow the active sentence again (see ticket 01).
const AUTO_SCROLL_RESUME_DELAY_MS = 4000;

// Scrollable rendering of the whole book's text, sentence by sentence: highlights
// whichever sentence is currently playing (or queued to play next, once paused - see
// ticket 02), auto-scrolls to keep it visible, and reports clicks (chunkIndex,
// sentenceIndex) - including on a sentence in a chunk that hasn't been generated yet -
// via onSentenceClick, so the caller can drive seeking (see ticket 01). Sentence
// clicking is disabled while playing, or while report mode is active (see ticket 06),
// so an accidental tap can't derail playback - scrolling itself is never affected
// either way (see ticket 02). Split out of
// AudioPlayer as its own component so it can scroll independently of the persistent
// PlayerBar (see ticket 07).
//
// The scroll-position indicator and "jump to now playing" control both moved into
// PlayerBar so they stay visible alongside the transport controls, grouped with
// play/pause, rather than floating over the text. Both still need
// this component's internal refs to actually do anything, so this component reports
// its scroll percentage upward via `onScrollPercentChange` (read direction) and exposes
// `jumpToNowPlaying`/`seekToScrollPercent` via an imperative handle (write direction,
// called by AudioPlayer on PlayerBar's behalf) rather than owning any of that UI itself.
const TranscriptView = forwardRef(function TranscriptView(
  {
    chunks,
    currentIndex,
    activeSentenceIndex,
    isPlaying,
    onSentenceClick,
    bookTitle,
    reportMode = false,
    onExitReportMode = () => {},
    onScrollPercentChange = () => {},
  },
  ref,
) {
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
  const [selectedPhrase, setSelectedPhrase] = useState(null);

  const updateScrollPercent = useCallback(() => {
    onScrollPercentChange(computeScrollPercent(scrollContainerRef.current));
  }, [onScrollPercentChange]);

  // A scroll the reader triggered themselves (as opposed to our own scrollIntoView
  // below) suspends auto-scroll rather than fighting them, resuming after a short idle
  // period. Reports every scroll regardless of source, so the indicator PlayerBar
  // renders stays in sync during auto-scroll and "jump to now playing" too (see ticket
  // 04).
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

  // PlayerBar's scroll-position indicator's drop target: sets the transcript's own
  // scrollTop directly from the target percentage. It never touches audio.currentTime
  // or chunk/sentence seeking - purely a text-scroll affordance (see ticket 04). Named
  // apart from "seek" (used elsewhere for audio/sentence seeking) so the two aren't
  // confused for one another. Deliberately bypasses the manual-scroll-suspends-auto-
  // scroll bookkeeping above (unlike a real scroll event) - dragging the indicator has
  // never suspended auto-follow, and this keeps that behavior unchanged.
  const seekToScrollPercent = useCallback(
    (percent) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollable = scrollableRange(container);
      container.scrollTop = scrollable > 0 ? (percent / 100) * scrollable : 0;
      onScrollPercentChange(percent);
    },
    [onScrollPercentChange],
  );

  // Shared by both the auto-scroll effect below and "jump to now playing" (see ticket
  // 03) - the same scrollIntoView call, marked programmatic so it doesn't itself trip
  // handleManualScroll's suspension above.
  const scrollToActiveSentence = useCallback(() => {
    const node = activeSentenceRef.current;
    if (!node) return undefined;

    isProgrammaticScrollRef.current = true;
    node.scrollIntoView({ block: 'center', behavior: 'auto' });
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
  const jumpToNowPlaying = useCallback(() => {
    suspendAutoScrollRef.current = false;
    clearTimeout(resumeAutoScrollTimeoutRef.current);
    scrollToActiveSentence();
  }, [scrollToActiveSentence]);

  useImperativeHandle(ref, () => ({ jumpToNowPlaying, seekToScrollPercent }), [
    jumpToNowPlaying,
    seekToScrollPercent,
  ]);

  // Report mode is an explicit opt-in from the bottom bar (see ticket 06) - outside of
  // it, an incidental selection made while just reading must never surface the report
  // affordance (that was the whole problem this ticket fixes). Leaving report mode -
  // whichever way that happens - clears out any in-progress selection/form too, so
  // re-entering it later always starts fresh.
  useEffect(() => {
    if (!reportMode) setSelectedPhrase(null);
  }, [reportMode]);

  // Native text selection (see ticket 06) - while report mode is active, a non-empty
  // selection surfaces the report form, pre-filled with the selected phrase.
  const handleTextSelection = useCallback(() => {
    if (!reportMode) return;
    const text = window.getSelection?.().toString().trim();
    if (text) setSelectedPhrase(text);
  }, [reportMode]);

  // Cancelling from the form and a successful submission both fully exit report mode
  // (not just this one phrase's form), restoring ordinary Sentence-click seeking (see
  // ticket 06).
  const handleReportDismiss = useCallback(() => {
    setSelectedPhrase(null);
    onExitReportMode();
  }, [onExitReportMode]);

  return (
    <Box display="flex" flexDirection="column" flex="1" minH={0} w="full">
      <Box position="relative" flex="1" minH={0} w="full">
        {selectedPhrase && (
          <PronunciationReportForm
            key={selectedPhrase}
            phrase={selectedPhrase}
            bookTitle={bookTitle}
            onDismiss={handleReportDismiss}
          />
        )}
        <Box
          ref={scrollContainerRef}
          onScroll={handleManualScroll}
          onMouseUp={handleTextSelection}
          onTouchEnd={handleTextSelection}
          h="full"
          w="full"
          maxW="640px"
          mx="auto"
          overflowY="auto"
          px={5}
          py={4}
          role="log"
          aria-label="書籍內文"
          css={{
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {chunks.map((_, chunkIndex) => (
            <Text as="p" key={chunkIndex} mb={4} fontSize="md" lineHeight="1.85">
              {sentencesByChunk[chunkIndex].map((sentence, sentenceIndex) => {
                const isActive =
                  chunkIndex === currentIndex && sentenceIndex === activeSentenceIndex;
                // Report mode disables Sentence-click seeking unconditionally, on top of
                // (not instead of) the existing playing-state gate - a report-mode tap
                // must never move playback (see ticket 06).
                const clickDisabled = isPlaying || reportMode;

                return (
                  <Text
                    as="span"
                    key={sentenceIndex}
                    ref={isActive ? activeSentenceRef : undefined}
                    data-testid={`sentence-${chunkIndex}-${sentenceIndex}`}
                    data-active={isActive ? 'true' : undefined}
                    bg={isActive ? 'activeSentenceBg' : undefined}
                    color={isActive ? 'activeSentenceFg' : undefined}
                    borderRadius="sm"
                    cursor={clickDisabled ? 'default' : 'pointer'}
                    onClick={
                      clickDisabled ? undefined : () => onSentenceClick(chunkIndex, sentenceIndex)
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
});

export default TranscriptView;
