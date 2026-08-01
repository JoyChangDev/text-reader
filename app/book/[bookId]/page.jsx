'use client';

import { Box, Spinner } from '@chakra-ui/react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import AudioPlayer from '@/app/_components/AudioPlayer';
import { getBook } from '@/app/_lib/bookLibrary';
import { clearLastOpenBook, getLastOpenBook, setLastOpenBook } from '@/app/_lib/lastOpenBook';

// The reader route: owns fetching its own book data (rather than receiving it as props
// from a parent holding it in memory, which is what the pre-Phase-1.9 single-route `/`
// did) so the URL itself is the source of truth for "which book am I reading" - see
// specs/phase-1-9-reader-route-restructure.md.
export default function BookPage() {
  const { bookId } = useParams();
  const router = useRouter();
  const [book, setBook] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getBook(bookId).then((entry) => {
      if (cancelled) return;
      if (!entry) {
        // A pointer that led here but no longer resolves is stale - clear it so `/`
        // doesn't redirect straight back into this same dead end (see
        // specs/phase-1-9-reader-route-restructure.md). Only clear it if it's actually
        // this bookId's pointer, so an unrelated pointer to a different, still-valid
        // book isn't collateral damage.
        if (getLastOpenBook() === bookId) clearLastOpenBook();
        setNotFound(true);
        return;
      }
      // Recorded only once the book is confirmed to exist, so a bad/stale link never
      // gets persisted as something to auto-restore into.
      setLastOpenBook(bookId);
      setBook(entry);
    });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // A deleted book (or a bad/stale link) has nowhere sensible to render - fall back to
  // the library rather than showing a broken player.
  useEffect(() => {
    if (notFound) router.replace('/');
  }, [notFound, router]);

  const handleBackToLibrary = useCallback(() => {
    // An explicit exit should be respected on the next launch, not silently overridden
    // by auto-restore pulling the Listener straight back into the book they just left.
    clearLastOpenBook();
    router.push('/');
  }, [router]);

  if (notFound) return null;

  if (!book) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        minH="100vh"
        bg="background"
        color="foreground"
      >
        <Spinner aria-label="載入書籍中" />
      </Box>
    );
  }

  return (
    <AudioPlayer
      key={book.bookId}
      bookId={book.bookId}
      chunks={book.chunks}
      initialIndex={book.resumeIndex}
      initialSentenceIndex={book.resumeSentenceIndex ?? 0}
      title={book.title}
      onBackToLibrary={handleBackToLibrary}
    />
  );
}
