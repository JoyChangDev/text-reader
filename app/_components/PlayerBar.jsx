'use client';

import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { FiArrowUp, FiPause, FiPlay, FiRefreshCw } from 'react-icons/fi';

import PlayerSettingsSheet from './PlayerSettingsSheet';
import ScrollPositionIndicator from './ScrollPositionIndicator';

// Persistent, media-player-style bottom bar: current chunk position, a scroll-position
// indicator for the transcript's own scroll geometry (independent of chunk/playback
// position - see ticket 04), and the transport controls all live here so they stay
// visible while TranscriptView scrolls above it (see ticket 07). Narration voice,
// playback speed, voice preview, and appearance all collapse behind PlayerSettingsSheet
// so this bar's persistent row stays short - "jump to now playing" and play/pause sit
// at the opposite (trailing) end of that row from the settings disclosure, grouped
// together since they're both transport actions.
export default function PlayerBar({
  currentIndex,
  totalChunks,
  isPlaying,
  currentChunkReady,
  currentChunkErrored,
  onPlay,
  onPause,
  onRetry,
  onJumpToNowPlaying,
  scrollPercent,
  onScrollPercentChange,
  voice,
  onVoiceChange,
  speed,
  onSpeedChange,
}) {
  return (
    <Box as="footer" flexShrink={0} w="full" bg="background" borderTopWidth="1px" px={4} py={3}>
      <Text fontSize="sm" mb={2}>
        Chunk {currentIndex + 1} of {totalChunks}
      </Text>
      {currentChunkErrored && (
        <Text color="danger" role="alert" mb={2}>
          Couldn&apos;t generate audio for this chunk.
        </Text>
      )}
      <ScrollPositionIndicator percent={scrollPercent} onPercentChange={onScrollPercentChange} />
      <HStack wrap="wrap">
        <PlayerSettingsSheet
          voice={voice}
          onVoiceChange={onVoiceChange}
          speed={speed}
          onSpeedChange={onSpeedChange}
          disabled={isPlaying}
        />
        <HStack ml="auto">
          <Button aria-label="Jump to now playing" variant="outline" onClick={onJumpToNowPlaying}>
            <FiArrowUp />
          </Button>
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
        </HStack>
      </HStack>
    </Box>
  );
}
