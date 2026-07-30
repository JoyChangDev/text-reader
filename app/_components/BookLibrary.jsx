'use client';

import { Button, Heading, HStack, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { deleteBook, listBooks } from '@/app/_lib/bookLibrary';

// Lists previously uploaded books from the local library so the reader can
// resume one. Reads the library on mount rather than on every render, so a
// book added elsewhere only shows up here once this component (re)mounts.
export default function BookLibrary({ onSelect }) {
  const [books, setBooks] = useState([]);

  useEffect(() => {
    // Deferred to an effect (not a lazy useState initializer) so the first
    // client render matches the server-rendered empty state before hydration,
    // then picks up the server-backed library once mounted.
    let cancelled = false;
    listBooks().then((fetchedBooks) => {
      if (!cancelled) setBooks(fetchedBooks);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fire-and-forget from the caller's perspective (the onClick below doesn't await
  // this), so a rejected fetch is caught here rather than becoming an unhandled
  // rejection - same pattern useBookPlayer.js uses for its resume-index persistence.
  const handleDelete = async (bookId) => {
    try {
      const deleted = await deleteBook(bookId);
      if (!deleted) return;

      setBooks((current) => current.filter((book) => book.bookId !== bookId));
    } catch (error) {
      console.error('Failed to delete book', error);
    }
  };

  if (!Array.isArray(books) || books.length === 0) return null;

  return (
    <VStack bg="background" color="foreground" align="start" gap={2}>
      <Heading size="sm">Your library</Heading>
      {books.map((book) => (
        <HStack key={book.bookId}>
          <Button variant="outline" onClick={() => onSelect(book.bookId)}>
            {book.title}
          </Button>
          <Button
            aria-label={`Delete ${book.title}`}
            variant="ghost"
            onClick={() => handleDelete(book.bookId)}
          >
            Delete
          </Button>
        </HStack>
      ))}
    </VStack>
  );
}
