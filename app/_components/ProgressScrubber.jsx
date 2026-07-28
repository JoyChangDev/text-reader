'use client';

import { Box, HStack, Text } from '@chakra-ui/react';

import { formatDuration } from '@/app/_lib/formatDuration';

// Whole-book, draggable progress bar: a row of segments (one per chunk, sized by its
// share of the book's total duration) shows generated chunks distinctly from
// not-yet-generated (estimated) ones, with a native range input layered on top so
// dragging/clicking anywhere - including into an estimated segment - reports a
// book-level seek target via onSeek (see ticket 08 and useBookPlayer's
// timeline/seekToBookOffset).
export default function ProgressScrubber({ segments, totalSeconds, currentTimeSeconds, onSeek }) {
  const roundedTotal = Math.max(Math.round(totalSeconds), 0);

  return (
    <Box mb={2}>
      <Box position="relative" h="6" w="full">
        <HStack position="absolute" inset="0" gap="1px" overflow="hidden" borderRadius="sm">
          {segments.map((segment) => (
            <Box
              key={segment.chunkIndex}
              data-testid={`scrubber-segment-${segment.chunkIndex}`}
              data-estimated={segment.isEstimated ? 'true' : undefined}
              flex={`${Math.max(segment.durationSeconds, 0.001)} 0 0`}
              h="full"
              bg={segment.isEstimated ? 'gray.400' : 'accent'}
            />
          ))}
        </HStack>
        <Box
          as="input"
          type="range"
          aria-label="Book progress"
          min={0}
          max={roundedTotal}
          step={1}
          value={Math.round(currentTimeSeconds)}
          onChange={(event) => onSeek(Number(event.target.value))}
          disabled={roundedTotal <= 0}
          position="absolute"
          inset="0"
          w="full"
          h="full"
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
      <Text fontSize="xs" mt={1}>
        {formatDuration(Math.floor(currentTimeSeconds))} / {formatDuration(roundedTotal)}
      </Text>
    </Box>
  );
}
