'use client';
import { Heading, HStack, VStack } from '@chakra-ui/react';
import { useCallback, useState } from 'react';

import AudioPlayer from './_components/AudioPlayer';
import BlobUsageIndicator from './_components/BlobUsageIndicator';
import BookLibrary from './_components/BookLibrary';
import BookUploader from './_components/BookUploader';
import VoicePreview from './_components/VoicePreview';
import { addBook, getBook } from './_lib/bookLibrary';

export default function Home() {
  const [book, setBook] = useState(null);

  const handleUploaded = useCallback(async ({ bookId, chunks, title }) => {
    await addBook({ bookId, title, chunks });
    setBook({ bookId, chunks, initialIndex: 0 });
  }, []);

  const handleSelectBook = useCallback(async (bookId) => {
    const entry = await getBook(bookId);
    if (!entry) return;
    setBook({ bookId: entry.bookId, chunks: entry.chunks, initialIndex: entry.resumeIndex });
  }, []);

  if (!book) {
    return (
      <VStack align="start" gap={6}>
        <BookUploader onReady={handleUploaded} />
        <VStack align="start" gap={2}>
          <Heading size="sm">Preview voices</Heading>
          <HStack wrap="wrap">
            <VoicePreview />
          </HStack>
        </VStack>
        <BookLibrary onSelect={handleSelectBook} />
        <BlobUsageIndicator />
      </VStack>
    );
  }

  return (
    <AudioPlayer
      key={book.bookId}
      bookId={book.bookId}
      chunks={book.chunks}
      initialIndex={book.initialIndex}
      onBackToLibrary={() => setBook(null)}
    />
  );
}
