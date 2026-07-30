'use client';

import { Box, HStack, Text } from '@chakra-ui/react';

// How far the reader has scrolled through the whole book's text, purely as a fraction
// of the transcript container's own scroll geometry - no chunk index or audio duration
// involved at all (replaces the whole-book progress scrubber, see ticket 04). Dragging
// or clicking only ever reports a target percentage via onPercentChange; it never
// touches audio.currentTime or chunk/sentence seeking - the caller (TranscriptView) is
// the one that turns that percentage back into a scrollTop.
export default function ScrollPositionIndicator({ percent, onPercentChange }) {
  const rounded = Math.round(percent);

  return (
    <HStack gap={2} mb={3} flexShrink={0}>
      <Box position="relative" h="1.5" flex="1">
        <Box
          position="absolute"
          inset="0"
          borderRadius="full"
          bg="backgroundSunken"
          overflow="hidden"
        >
          <Box h="full" bg="foregroundFaint" w={`${rounded}%`} />
        </Box>
        <Box
          as="input"
          type="range"
          aria-label="文字位置"
          min={0}
          max={100}
          step={1}
          value={rounded}
          onChange={(event) => onPercentChange(Number(event.target.value))}
          position="absolute"
          inset="0"
          w="full"
          h="6"
          top="-9px"
          m={0}
          cursor="pointer"
          css={{
            appearance: 'none',
            background: 'transparent',
            '&::-webkit-slider-runnable-track': { background: 'transparent' },
            '&::-moz-range-track': { background: 'transparent' },
          }}
        />
      </Box>
      <Text
        fontSize="xs"
        color="foregroundFaint"
        w="9"
        textAlign="right"
        flexShrink={0}
        fontVariantNumeric="tabular-nums"
      >
        {rounded}%
      </Text>
    </HStack>
  );
}
