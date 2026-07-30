'use client';

import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { FiArrowUp, FiFlag, FiPause, FiPlay, FiRefreshCw } from 'react-icons/fi';

import PlayerSettingsSheet from './PlayerSettingsSheet';
import ScrollPositionIndicator from './ScrollPositionIndicator';

// Persistent, media-player-style bottom bar: current chunk position, a scroll-position
// indicator for the transcript's own scroll geometry (independent of chunk/playback
// position - see ticket 04), and the transport controls all live here so they stay
// visible while TranscriptView scrolls above it (see ticket 07). Narration voice,
// playback speed, voice preview, and appearance all collapse behind PlayerSettingsSheet
// so this bar's persistent row stays short - "jump to now playing" and play/pause sit
// at the opposite (trailing) end of that row from the settings disclosure, grouped
// together since they're both transport actions. The report-mode toggle sits right next
// to the settings disclosure (see ticket 06) - both are mode-entry controls, distinct
// from the transport actions on the trailing end.
export default function PlayerBar({
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
  reportMode,
  onToggleReportMode,
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
        {currentChunkErrored && (
          <Text color="danger" role="alert" mb={2}>
            此段落的語音產生失敗。
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
          <IconButton
            aria-label="回報發音問題"
            aria-pressed={reportMode}
            variant={reportMode ? 'solid' : 'outline'}
            borderRadius="full"
            borderColor="hairlineStrong"
            onClick={onToggleReportMode}
          >
            <FiFlag />
          </IconButton>
          <HStack ml="auto" gap={2}>
            <IconButton
              aria-label="跳到目前播放位置"
              variant="outline"
              borderRadius="full"
              borderColor="hairlineStrong"
              onClick={onJumpToNowPlaying}
            >
              <FiArrowUp />
            </IconButton>
            {isPlaying ? (
              <IconButton
                aria-label="暫停"
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
                aria-label="重試"
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
                aria-label="播放"
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
