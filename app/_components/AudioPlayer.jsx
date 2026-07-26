'use client';

import { Button, HStack, Text, VStack } from '@chakra-ui/react';

import { useBookPlayer } from '@/app/_lib/useBookPlayer';

// Sequential chunk player: plays one chunk at a time while a small look-ahead
// buffer of upcoming chunks generates in the background (see useBookPlayer).
export default function AudioPlayer({ bookId, chunks, initialIndex = 0, onBackToLibrary }) {
  const { audioRef, currentIndex, isPlaying, chunkAudio, play, pause, handleEnded } = useBookPlayer(
    { bookId, chunks, initialIndex },
  );

  const currentChunkReady = chunkAudio[currentIndex]?.status === 'ready';

  return (
    <VStack bg="background" color="foreground" align="start" gap={2}>
      <Button variant="plain" onClick={onBackToLibrary}>
        Back to library
      </Button>
      <Text>
        Chunk {currentIndex + 1} of {chunks.length}
      </Text>
      <HStack>
        {isPlaying ? (
          <Button onClick={pause}>Pause</Button>
        ) : (
          <Button onClick={play} disabled={!currentChunkReady}>
            Play
          </Button>
        )}
      </HStack>
      <audio ref={audioRef} onEnded={handleEnded} data-testid="audio-element" />
    </VStack>
  );
}
