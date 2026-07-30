'use client';
import { VStack } from '@chakra-ui/react';
import { useCallback, useState } from 'react';

import AudioPlayer from './_components/AudioPlayer';
import BlobUsageIndicator from './_components/BlobUsageIndicator';
import BookLibrary from './_components/BookLibrary';
import BookUploader from './_components/BookUploader';
import { addBook, getBook } from './_lib/bookLibrary';

export default function Home() {
  const [book, setBook] = useState(null);

  const handleUploaded = useCallback(async ({ bookId, chunks, title }) => {
    await addBook({ bookId, title, chunks });
    setBook({ bookId, chunks, initialIndex: 0, title });
  }, []);

  const handleSelectBook = useCallback(async (bookId) => {
    const entry = await getBook(bookId);
    if (!entry) return;
    setBook({
      bookId: entry.bookId,
      chunks: entry.chunks,
      initialIndex: entry.resumeIndex,
      title: entry.title,
    });
  }, []);

  if (!book) {
    return (
      <VStack align="start" gap={6}>
        <BookUploader onReady={handleUploaded} />
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
      title={book.title}
      onBackToLibrary={() => setBook(null)}
    />
  );
}
