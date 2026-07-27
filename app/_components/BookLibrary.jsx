'use client';

import { Button, Heading, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { listBooks } from '@/app/_lib/bookLibrary';

// Lists previously uploaded books from the local library so the reader can
// resume one. Reads the library on mount rather than on every render, so a
// book added elsewhere only shows up here once this component (re)mounts.
export default function BookLibrary({ onSelect }) {
  const [books, setBooks] = useState([]);

  useEffect(() => {
    // Deferred to an effect (not a lazy useState initializer) so the first
    // client render matches the server-rendered empty state before hydration,
    // then picks up the real localStorage-backed library once mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBooks(listBooks());
  }, []);

  if (books.length === 0) return null;

  return (
    <VStack bg="background" color="foreground" align="start" gap={2}>
      <Heading size="sm">Your library</Heading>
      {books.map((book) => (
        <Button key={book.bookId} variant="outline" onClick={() => onSelect(book.bookId)}>
          {book.title}
        </Button>
      ))}
    </VStack>
  );
}
