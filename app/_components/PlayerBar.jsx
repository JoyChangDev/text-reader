'use client';

import { Box, Button, HStack, NativeSelect, Text } from '@chakra-ui/react';
import { FiPause, FiPlay, FiRefreshCw } from 'react-icons/fi';

import { AVAILABLE_SPEEDS, AVAILABLE_VOICES } from '@/app/_lib/listenerSettings';

import ProgressScrubber from './ProgressScrubber';
import ThemeToggle from './ThemeToggle';

// Persistent, media-player-style bottom bar: the whole-book progress scrubber (ticket
// 08), current chunk position, transport controls (play/pause/retry, using standard
// media-player glyphs rather than text labels), the voice picker, the speed control,
// and the theme picker (ticket 09) all live here so they stay visible while
// TranscriptView scrolls above it (see ticket 07). The voice and speed pickers are
// disabled while a chunk is actively playing, so an accidental change doesn't happen
// mid-sentence - pausing unlocks them again (see ticket 02).
export default function PlayerBar({
  currentIndex,
  totalChunks,
  isPlaying,
  currentChunkReady,
  currentChunkErrored,
  onPlay,
  onPause,
  onRetry,
  voice,
  onVoiceChange,
  speed,
  onSpeedChange,
  previewingVoice,
  onTogglePreviewVoice,
  segments,
  totalSeconds,
  bookPositionSeconds,
  onSeek,
}) {
  return (
    <Box as="footer" flexShrink={0} w="full" bg="background" borderTopWidth="1px" px={4} py={3}>
      <ProgressScrubber
        segments={segments}
        totalSeconds={totalSeconds}
        currentTimeSeconds={bookPositionSeconds}
        onSeek={onSeek}
      />
      <Text fontSize="sm" mb={2}>
        Chunk {currentIndex + 1} of {totalChunks}
      </Text>
      {currentChunkErrored && (
        <Text color="danger" role="alert" mb={2}>
          Couldn&apos;t generate audio for this chunk.
        </Text>
      )}
      <HStack wrap="wrap">
        {isPlaying ? (
          <Button aria-label="Pause" onClick={onPause}>
            <FiPause />
          </Button>
        ) : currentChunkErrored ? (
          <Button aria-label="Retry" onClick={onRetry}>
            <FiRefreshCw />
          </Button>
        ) : (
          <Button aria-label="Play" onClick={onPlay} disabled={!currentChunkReady}>
            <FiPlay />
          </Button>
        )}
        <NativeSelect.Root width="auto" disabled={isPlaying}>
          <NativeSelect.Field aria-label="Narration voice" value={voice} onChange={onVoiceChange}>
            {AVAILABLE_VOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <NativeSelect.Root width="auto" disabled={isPlaying}>
          <NativeSelect.Field aria-label="Playback speed" value={speed} onChange={onSpeedChange}>
            {AVAILABLE_SPEEDS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {AVAILABLE_VOICES.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            onClick={() => onTogglePreviewVoice(option.value)}
          >
            {previewingVoice === option.value ? `Stop ${option.label}` : `Preview ${option.label}`}
          </Button>
        ))}
        <ThemeToggle />
      </HStack>
    </Box>
  );
}
