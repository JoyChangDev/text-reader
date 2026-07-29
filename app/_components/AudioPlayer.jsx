'use client';

import { Box, Button } from '@chakra-ui/react';
import { useCallback, useRef, useState } from 'react';

import {
  getListenerSettings,
  updateListenerSettings,
  voiceSampleUrl,
} from '@/app/_lib/listenerSettings';
import { useBookPlayer } from '@/app/_lib/useBookPlayer';

import PlayerBar from './PlayerBar';
import TranscriptView from './TranscriptView';

// Sequential chunk player: plays one chunk at a time while a small look-ahead
// buffer of upcoming chunks generates in the background (see useBookPlayer). Renders
// the whole book's text via TranscriptView (scrollable, sentence highlighting/seeking)
// with a persistent PlayerBar fixed at the bottom of the viewport (see ticket 07).
export default function AudioPlayer({ bookId, chunks, initialIndex = 0, onBackToLibrary }) {
  const [voice, setVoice] = useState(() => getListenerSettings().voice);
  const [speed, setSpeed] = useState(() => getListenerSettings().speed);
  const {
    audioRef,
    currentIndex,
    isPlaying,
    chunkAudio,
    activeSentenceIndex,
    timeline,
    bookPositionSeconds,
    seekToBookOffset,
    play,
    pause,
    handleEnded,
    handleTimeUpdate,
    seekToSentence,
    retryChunk,
  } = useBookPlayer({ bookId, chunks, initialIndex, voice, speed });

  // Prospective only: this only affects chunks fetched from here on - chunks already
  // cached/generated under the previous voice keep playing as-is (see ticket 02).
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

  // Previewing plays a static, pre-generated clip (see scripts/generate-voice-samples.mjs)
  // through a separate <audio> element - it never touches the persisted selection, calls
  // edge-tts, or requests /api/audio-chunks (see ticket 03).
  const [previewingVoice, setPreviewingVoice] = useState(null);
  const previewAudioRef = useRef(null);

  const togglePreviewVoice = useCallback(
    (voiceValue) => {
      const previewAudio = previewAudioRef.current;
      if (!previewAudio) return;

      if (previewingVoice === voiceValue) {
        previewAudio.pause();
        setPreviewingVoice(null);
        return;
      }

      previewAudio.src = voiceSampleUrl(voiceValue);
      previewAudio.play();
      setPreviewingVoice(voiceValue);
    },
    [previewingVoice],
  );

  const handlePreviewEnded = useCallback(() => setPreviewingVoice(null), []);

  const handleRetry = useCallback(() => retryChunk(currentIndex), [retryChunk, currentIndex]);

  const currentChunkStatus = chunkAudio[currentIndex]?.status;
  const currentChunkReady = currentChunkStatus === 'ready';
  const currentChunkErrored = currentChunkStatus === 'error';

  return (
    <Box
      bg="background"
      color="foreground"
      display="flex"
      flexDirection="column"
      h="100vh"
      overflow="hidden"
    >
      <Button variant="plain" alignSelf="start" m={2} onClick={onBackToLibrary}>
        Back to library
      </Button>
      <TranscriptView
        chunks={chunks}
        currentIndex={currentIndex}
        activeSentenceIndex={activeSentenceIndex}
        isPlaying={isPlaying}
        onSentenceClick={seekToSentence}
      />
      <PlayerBar
        currentIndex={currentIndex}
        totalChunks={chunks.length}
        isPlaying={isPlaying}
        currentChunkReady={currentChunkReady}
        currentChunkErrored={currentChunkErrored}
        onPlay={play}
        onPause={pause}
        onRetry={handleRetry}
        voice={voice}
        onVoiceChange={handleVoiceChange}
        speed={speed}
        onSpeedChange={handleSpeedChange}
        previewingVoice={previewingVoice}
        onTogglePreviewVoice={togglePreviewVoice}
        segments={timeline.segments}
        totalSeconds={timeline.totalSeconds}
        bookPositionSeconds={bookPositionSeconds}
        onSeek={seekToBookOffset}
      />
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        data-testid="audio-element"
      />
      <audio ref={previewAudioRef} onEnded={handlePreviewEnded} data-testid="voice-preview-audio" />
    </Box>
  );
}
