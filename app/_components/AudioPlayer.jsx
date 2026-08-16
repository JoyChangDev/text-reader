'use client';

import { Box, Button } from '@chakra-ui/react';
import { useCallback, useRef, useState } from 'react';
import { FiChevronLeft } from 'react-icons/fi';

import { getListenerSettings, updateListenerSettings } from '@/app/_lib/listenerSettings';
import { useBookPlayer } from '@/app/_lib/useBookPlayer';
import { useMediaSession } from '@/app/_lib/useMediaSession';

import BackgroundDiagnosticsPanel from './BackgroundDiagnosticsPanel';
import PlayerBar from './PlayerBar';
import TranscriptView from './TranscriptView';

// Continuous player: one <audio> element playing the Book's whole EVENT playlist, while
// a look-ahead buffer of upcoming Chunks generates in the background and grows it (see
// useBookPlayer). Renders the whole book's text via TranscriptView (scrollable, sentence
// highlighting/seeking) with a persistent PlayerBar fixed at the bottom of the viewport
// (see phase 1.5 ticket 07).
export default function AudioPlayer({
  bookId,
  chunks,
  initialIndex = 0,
  initialSentenceIndex = 0,
  title,
  onBackToLibrary,
}) {
  const [voice, setVoice] = useState(() => getListenerSettings().voice);
  const [speed, setSpeed] = useState(() => getListenerSettings().speed);
  const {
    audioRef,
    currentIndex,
    isPlaying,
    chunkAudio,
    activeSentenceIndex,
    play,
    pause,
    handleEnded,
    handleMediaError,
    mediaErrorCode,
    seekToSentence,
    retryChunk,
  } = useBookPlayer({ bookId, chunks, initialIndex, initialSentenceIndex, voice, speed });

  useMediaSession({ title, isPlaying, play, pause });

  // TranscriptView owns the scroll container and active-sentence refs this all needs
  // (see TranscriptView's own doc comment) - it reports its own scroll percentage up
  // via onScrollPercentChange (read direction) and exposes jumpToNowPlaying/
  // seekToScrollPercent via an imperative handle (write direction) so PlayerBar, a
  // sibling, can drive both without either component owning the other's internals.
  const transcriptRef = useRef(null);
  const [scrollPercent, setScrollPercent] = useState(0);

  // Report mode is lifted here (rather than owned by TranscriptView, which surfaces the
  // selection that feeds it) since both PlayerBar's toggle and TranscriptView's
  // Sentence-click gating need to read/drive it (see ticket 06).
  const [reportMode, setReportMode] = useState(false);
  const handleToggleReportMode = useCallback(() => setReportMode((current) => !current), []);
  const handleExitReportMode = useCallback(() => setReportMode(false), []);

  const handleJumpToNowPlaying = useCallback(() => {
    transcriptRef.current?.jumpToNowPlaying();
  }, []);

  const handleScrollPercentChange = useCallback((percent) => {
    transcriptRef.current?.seekToScrollPercent(percent);
  }, []);

  // The playlist is per (Book, voice), so this re-points the element at a different one
  // and restarts the Book - the reason the picker is locked while playing. Chunks already
  // generated under the previous voice are left alone rather than regenerated: they are
  // simply not in the new voice's playlist (see phase 1.5 ticket 02).
  const handleVoiceChange = useCallback((event) => {
    const nextVoice = event.target.value;
    setVoice(nextVoice);
    updateListenerSettings({ voice: nextVoice });
  }, []);

  // Applies immediately to whatever's currently playing (via useBookPlayer) and
  // persists as a device-wide default across books (see ticket 04).
  const handleSpeedChange = useCallback((event) => {
    const nextSpeed = Number(event.target.value);
    setSpeed(nextSpeed);
    updateListenerSettings({ speed: nextSpeed });
  }, []);

  const handleRetry = useCallback(() => retryChunk(currentIndex), [retryChunk, currentIndex]);

  const currentChunkStatus = chunkAudio[currentIndex]?.status;
  const currentChunkReady = currentChunkStatus === 'ready';
  const currentChunkErrored = currentChunkStatus === 'error';
  // Narration for the Sentence being read is still being synthesised. Worth saying out loud
  // rather than only disabling the play button: after a long seek this is a real round-trip,
  // and a dead button with no explanation is the same silence ticket 15 was filed about.
  const currentChunkPending = currentChunkStatus === 'loading';

  return (
    <Box
      bg="background"
      color="foreground"
      display="flex"
      flexDirection="column"
      h="100dvh"
      overflow="hidden"
      // A Home Screen (standalone) launch draws the page under the translucent status
      // bar - see the `black-translucent` style and matching `viewport-fit=cover` in
      // app/layout.jsx - so without this the "返回書庫" button below sits underneath the
      // notch/status bar. Padding rather than a shorter height so the background still
      // bleeds to the top edge, which is the point of the translucent style.
      pt="env(safe-area-inset-top)"
    >
      <Button
        variant="plain"
        color="foregroundMuted"
        alignSelf="start"
        px={4}
        pt={3}
        pb={1}
        onClick={onBackToLibrary}
      >
        <FiChevronLeft /> 返回書庫
      </Button>
      <TranscriptView
        ref={transcriptRef}
        chunks={chunks}
        currentIndex={currentIndex}
        activeSentenceIndex={activeSentenceIndex}
        isPlaying={isPlaying}
        onSentenceClick={seekToSentence}
        bookTitle={title}
        reportMode={reportMode}
        onExitReportMode={handleExitReportMode}
        onScrollPercentChange={setScrollPercent}
      />
      <PlayerBar
        isPlaying={isPlaying}
        currentChunkReady={currentChunkReady}
        currentChunkErrored={currentChunkErrored}
        currentChunkPending={currentChunkPending}
        onPlay={play}
        onPause={pause}
        onRetry={handleRetry}
        onJumpToNowPlaying={handleJumpToNowPlaying}
        scrollPercent={scrollPercent}
        onScrollPercentChange={handleScrollPercentChange}
        voice={voice}
        onVoiceChange={handleVoiceChange}
        speed={speed}
        onSpeedChange={handleSpeedChange}
        reportMode={reportMode}
        onToggleReportMode={handleToggleReportMode}
        mediaErrorCode={mediaErrorCode}
      />
      <BackgroundDiagnosticsPanel />
      {/* One element for the whole Book, pointed at its EVENT playlist by useBookPlayer.
          Deliberately without `crossorigin`: nothing here reads the audio data or loads a
          <track src>, so requiring CORS on segment responses would be a constraint the
          design doesn't otherwise have (see ticket 04). */}
      <audio
        ref={audioRef}
        preload="auto"
        onEnded={handleEnded}
        onError={handleMediaError}
        data-testid="audio-element"
      />
    </Box>
  );
}
