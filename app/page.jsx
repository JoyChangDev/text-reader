'use client';
import { VStack } from '@chakra-ui/react';
import { useCallback, useState } from 'react';

import AudioPlayer from './_components/AudioPlayer';
import BookLibrary from './_components/BookLibrary';
import BookUploader from './_components/BookUploader';
import { addBook, getBook } from './_lib/bookLibrary';

export default function Home() {
  const [book, setBook] = useState(null);

  const handleUploaded = useCallback(({ bookId, chunks, title }) => {
    addBook({ bookId, title, chunks });
    setBook({ bookId, chunks, initialIndex: 0 });
  }, []);

  const handleSelectBook = useCallback((bookId) => {
    const entry = getBook(bookId);
    if (!entry) return;
    setBook({ bookId: entry.bookId, chunks: entry.chunks, initialIndex: entry.resumeIndex });
  }, []);

  if (!book) {
    return (
      <VStack align="start" gap={6}>
        <BookUploader onReady={handleUploaded} />
        <BookLibrary onSelect={handleSelectBook} />
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
