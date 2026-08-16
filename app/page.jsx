'use client';
import { Box, HStack, VStack } from '@chakra-ui/react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import BlobUsageIndicator from './_components/BlobUsageIndicator';
import BookLibrary from './_components/BookLibrary';
import BookUploader from './_components/BookUploader';
import PlayerSettingsSheet from './_components/PlayerSettingsSheet';
import { addBook } from './_lib/bookLibrary';
import { getLastOpenBook, hasReaderOpenedInThisDocument } from './_lib/lastOpenBook';
import { getListenerSettings, updateListenerSettings } from './_lib/listenerSettings';

// The library route: which book is open lives in the URL (see
// app/book/[bookId]/page.jsx), not in state here - see
// specs/phase-1-9-reader-route-restructure.md for why a killed/reloaded process needs
// the URL, not in-memory state, to know what to show.
export default function Home() {
  const router = useRouter();
  // Read synchronously (not in an effect) so a Listener with a last-open book never
  // sees the library flash before the redirect below fires. If the pointed-to book has
  // since been deleted, app/book/[bookId]/page.jsx clears it and redirects back here,
  // where this will then read null and fall through to the library normally - no need
  // to duplicate that existence check here too.
  //
  // Only on the first arrival in this document. Reaching here with the reader already
  // open in this document means the Listener navigated back out of it, and redirecting
  // then would make the back gesture a no-op - `/` bouncing straight into the route the
  // Listener just left, with no way to the library except 返回書庫.
  const [lastOpenBookId] = useState(() =>
    hasReaderOpenedInThisDocument() ? null : getLastOpenBook(),
  );
  // Same device-scoped voice/speed defaults AudioPlayer reads on mount (see
  // listenerSettings.js) - surfaced here too so the Listener can preview a voice and
  // set their preferred speed/theme before ever opening a book, not just mid-playback.
  // AudioPlayer re-reads them fresh from storage each time a book is opened, so a
  // change made here is already in effect by the time that happens.
  const [voice, setVoice] = useState(() => getListenerSettings().voice);
  const [speed, setSpeed] = useState(() => getListenerSettings().speed);

  useEffect(() => {
    if (lastOpenBookId) router.replace(`/book/${lastOpenBookId}`);
  }, [lastOpenBookId, router]);

  const handleUploaded = useCallback(
    async ({ bookId, chunks, title }) => {
      await addBook({ bookId, title, chunks });
      router.push(`/book/${bookId}`);
    },
    [router],
  );

  const handleSelectBook = useCallback(
    (bookId) => {
      router.push(`/book/${bookId}`);
    },
    [router],
  );

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

  // Nothing to render while a redirect to the last-open book is in flight - avoids a
  // flash of the library screen just before bouncing away from it.
  if (lastOpenBookId) return null;

  return (
    <Box
      bg="background"
      color="foreground"
      display="flex"
      flexDirection="column"
      h="100dvh"
      overflowY="auto"
    >
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
