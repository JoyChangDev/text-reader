'use client';

import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { FiArrowUp, FiFlag, FiPause, FiPlay, FiRefreshCw } from 'react-icons/fi';

import PlayerSettingsSheet from './PlayerSettingsSheet';
import ScrollPositionIndicator from './ScrollPositionIndicator';

// MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED. Spelled out rather than read off the interface,
// which is only reachable through a media element and is not worth reaching for to compare
// one number.
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

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
  // A MediaError code, or null for "the element has not refused this source". Defaulted so
  // there is one absent value rather than two - `0` is a real code here (see
  // useBookPlayer's MEDIA_ERR_UNKNOWN), so a truthiness check would swallow it.
  mediaErrorCode = null,
}) {
  return (
    <Box
      as="footer"
      flexShrink={0}
      w="full"
      bg="background"
      borderTopWidth="1px"
      borderColor="hairline"
      // Keeps the transport controls clear of the home indicator on a Home Screen
      // (standalone) launch - see app/layout.jsx for why the page runs edge to edge.
      // The inset sits on this outer element so the inner one's `pb={3}` stays a plain
      // spacing token rather than becoming a calc() of two unrelated things.
      pb="env(safe-area-inset-bottom)"
    >
      <Box maxW="640px" mx="auto" px={4} pt={2} pb={3}>
        {currentChunkErrored && (
          <Text color="danger" role="alert" mb={2}>
            此段落的語音產生失敗。
          </Text>
        )}
        {/* What the media element reported about the source, as opposed to the line above,
            which is about generating a Chunk. MEDIA_ERR_SRC_NOT_SUPPORTED is its own
            message because it is not a fault to retry: the playlist is HLS, and a browser
            without a demuxer for it will refuse it every time (see ADR 0003 and ticket
            06). Retrying is worth suggesting for anything else - a decode or network
            failure is about this attempt, not about the browser. */}
        {mediaErrorCode !== null && (
          <Text color="danger" role="alert" mb={2}>
            {mediaErrorCode === MEDIA_ERR_SRC_NOT_SUPPORTED
              ? '這個瀏覽器無法播放這本書的音訊，請改用 Safari 或 iPhone 聆聽。'
              : '播放時發生錯誤，請重新整理後再試。'}
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
