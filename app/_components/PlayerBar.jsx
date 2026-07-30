'use client';

import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
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
    <Box
      as="footer"
      flexShrink={0}
      w="full"
      bg="background"
      borderTopWidth="1px"
      borderColor="hairline"
    >
      <Box maxW="640px" mx="auto" px={4} pt={2} pb={3}>
        <Text fontSize="xs" color="foregroundFaint" mb={2}>
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
          <HStack ml="auto" gap={2}>
            <IconButton
              aria-label="Jump to now playing"
              variant="outline"
              borderRadius="full"
              borderColor="hairlineStrong"
              onClick={onJumpToNowPlaying}
            >
              <FiArrowUp />
            </IconButton>
            {isPlaying ? (
              <IconButton
                aria-label="Pause"
                borderRadius="full"
                boxSize="13"
                bg="accent"
                color="accentContrast"
                _hover={{ opacity: 0.9 }}
                onClick={onPause}
              >
                <FiPause />
              </IconButton>
            ) : currentChunkErrored ? (
              <IconButton
                aria-label="Retry"
                borderRadius="full"
                boxSize="13"
                bg="accent"
                color="accentContrast"
                _hover={{ opacity: 0.9 }}
                onClick={onRetry}
              >
                <FiRefreshCw />
              </IconButton>
            ) : (
              <IconButton
                aria-label="Play"
                borderRadius="full"
                boxSize="13"
                bg="accent"
                color="accentContrast"
                _hover={{ opacity: 0.9 }}
                onClick={onPlay}
                disabled={!currentChunkReady}
              >
                <FiPlay />
              </IconButton>
            )}
          </HStack>
        </HStack>
      </Box>
    </Box>
  );
}
