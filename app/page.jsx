'use client';
import { Box, HStack, VStack } from '@chakra-ui/react';
import NextLink from 'next/link';
import { useCallback, useState } from 'react';

import AudioPlayer from './_components/AudioPlayer';
import BlobUsageIndicator from './_components/BlobUsageIndicator';
import BookLibrary from './_components/BookLibrary';
import BookUploader from './_components/BookUploader';
import PlayerSettingsSheet from './_components/PlayerSettingsSheet';
import { addBook, getBook } from './_lib/bookLibrary';
import { getListenerSettings, updateListenerSettings } from './_lib/listenerSettings';

export default function Home() {
  const [book, setBook] = useState(null);
  // Same device-scoped voice/speed defaults AudioPlayer reads on mount (see
  // listenerSettings.js) - surfaced here too so the Listener can preview a voice and
  // set their preferred speed/theme before ever opening a book, not just mid-playback.
  // AudioPlayer re-reads them fresh from storage each time a book is opened, so a
  // change made here is already in effect by the time that happens.
  const [voice, setVoice] = useState(() => getListenerSettings().voice);
  const [speed, setSpeed] = useState(() => getListenerSettings().speed);

  const handleUploaded = useCallback(async ({ bookId, chunks, title }) => {
    await addBook({ bookId, title, chunks });
    setBook({ bookId, chunks, initialIndex: 0, initialSentenceIndex: 0, title });
  }, []);

  const handleSelectBook = useCallback(async (bookId) => {
    const entry = await getBook(bookId);
    if (!entry) return;
    setBook({
      bookId: entry.bookId,
      chunks: entry.chunks,
      initialIndex: entry.resumeIndex,
      // Legacy entries saved before Sentence-level tracking existed have no
      // resumeSentenceIndex - fall back to the start of the resumed Chunk (see ticket 05).
      initialSentenceIndex: entry.resumeSentenceIndex ?? 0,
      title: entry.title,
    });
  }, []);

  const handleVoiceChange = useCallback((event) => {
    const nextVoice = event.target.value;
    setVoice(nextVoice);
    updateListenerSettings({ voice: nextVoice });
  }, []);

  const handleSpeedChange = useCallback((event) => {
    const nextSpeed = Number(event.target.value);
    setSpeed(nextSpeed);
    updateListenerSettings({ speed: nextSpeed });
  }, []);

  if (!book) {
    return (
      <Box bg="background" color="foreground" display="flex" flexDirection="column" minH="100vh">
        <VStack align="start" gap={6} flex="1" maxW="640px" mx="auto" w="full" px={4} py={8}>
          <BookUploader onReady={handleUploaded} />
          <BookLibrary onSelect={handleSelectBook} />
          <BlobUsageIndicator />
        </VStack>
        <Box as="footer" flexShrink={0} w="full" borderTopWidth="1px" borderColor="hairline">
          <HStack justify="space-between" maxW="640px" mx="auto" px={4} py={3}>
            <PlayerSettingsSheet
              voice={voice}
              onVoiceChange={handleVoiceChange}
              speed={speed}
              onSpeedChange={handleSpeedChange}
              disabled={false}
            />
            <Box
              as={NextLink}
              href="/pronunciation-reports"
              fontSize="sm"
              color="foregroundMuted"
              _hover={{ color: 'foreground' }}
            >
              發音回報
            </Box>
          </HStack>
        </Box>
      </Box>
    );
  }

  return (
    <AudioPlayer
      key={book.bookId}
      bookId={book.bookId}
      chunks={book.chunks}
      initialIndex={book.initialIndex}
      initialSentenceIndex={book.initialSentenceIndex}
      title={book.title}
      onBackToLibrary={() => setBook(null)}
    />
  );
}
