'use client';

import { Box, Button, Spinner, Text, VStack } from '@chakra-ui/react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import AudioPlayer from '@/app/_components/AudioPlayer';
import { deleteBook, getBook, INCOMPLETE_BOOK_STATUS } from '@/app/_lib/bookLibrary';
import { clearLastOpenBook, getLastOpenBook, setLastOpenBook } from '@/app/_lib/lastOpenBook';

// Everything this route renders other than the reader itself is one centred thing on an
// otherwise empty screen - the loading spinner, and the error states below it.
function FullScreen({ children, ...props }) {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      h="100dvh"
      bg="background"
      color="foreground"
      {...props}
    >
      {children}
    </Box>
  );
}

// The reader route: owns fetching its own book data (rather than receiving it as props
// from a parent holding it in memory, which is what the pre-Phase-1.9 single-route `/`
// did) so the URL itself is the source of truth for "which book am I reading" - see
// specs/phase-1-9-reader-route-restructure.md.
export default function BookPage() {
  const { bookId } = useParams();
  const router = useRouter();
  const [book, setBook] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // A pointer that led here but no longer resolves is stale - clear it so `/` doesn't
    // redirect straight back into this same dead end (see
    // specs/phase-1-9-reader-route-restructure.md). Only clear it if it's actually this
    // bookId's pointer, so an unrelated pointer to a different, still-valid book isn't
    // collateral damage.
    const dropStalePointer = () => {
      if (getLastOpenBook() === bookId) clearLastOpenBook();
    };

    getBook(bookId)
      .then((entry) => {
        if (cancelled) return;
        if (!entry) {
          dropStalePointer();
          setNotFound(true);
          return;
        }
        // Recorded only once the book is confirmed to exist, so a bad/stale link never
        // gets persisted as something to auto-restore into.
        setLastOpenBook(bookId);
        setBook(entry);
      })
      // getBook rejects rather than resolving null for everything except a 404 (see ticket
      // 06). Without this the rejection would be unhandled and the route would sit on its
      // loading spinner - which is how a Book whose text was never stored used to look
      // like a Book that was merely slow.
      .catch((error) => {
        console.error('Failed to open the book', error);
        if (cancelled) return;
        // Only the permanent failure drops the pointer: a Book whose text was never stored
        // fails identically on every launch, so auto-restoring into it would land the
        // Listener on this error screen every time they open the app. A store that could
        // not be reached is not that - the same Book will very likely open next time, and
        // forgetting it would make a blip cost the Listener their place.
        if (error.status === INCOMPLETE_BOOK_STATUS) dropStalePointer();
        setLoadError(error);
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

  // Offered only for a Book whose text was never stored, and only from the error screen
  // below. The ticket's own instruction - "The Book should stop existing, or stop being
  // incomplete" - and there is nothing to lose: the entry advertises a Book whose text no
  // longer exists anywhere, so the Library's ordinary cascade delete is exactly right. A
  // failure to delete leaves the message on screen rather than pretending it worked; the
  // Listener still has 返回書庫.
  const handleDeleteIncompleteBook = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteBook(bookId);
      clearLastOpenBook();
      router.push('/');
    } catch (error) {
      console.error('Failed to delete the incomplete book', error);
      setIsDeleting(false);
    }
  }, [bookId, router]);

  if (notFound) return null;

  // Deliberately not a redirect: a Book whose text was never stored fails the same way on
  // every launch and on every device, so bouncing back to the Library would hide it again
  // exactly as the empty reader did. The Listener is told what happened, and is offered the
  // one thing that ends it - the ticket's "the Book should stop existing" - rather than
  // being sent to the Library to work out which entry to delete (see ticket 06).
  if (loadError) {
    const isIncomplete = loadError.status === INCOMPLETE_BOOK_STATUS;

    return (
      <FullScreen px={6}>
        <VStack gap={4} maxW="420px" textAlign="center">
          <Text color="danger" role="alert">
            {isIncomplete
              ? '這本書的內容沒有儲存成功，無法閱讀。刪除後重新上傳即可。'
              : '無法載入這本書，請稍後再試。'}
          </Text>
          {isIncomplete && (
            <Button
              size="sm"
              borderRadius="full"
              variant="outline"
              borderColor="hairlineStrong"
              loading={isDeleting}
              onClick={handleDeleteIncompleteBook}
            >
              刪除這本書
            </Button>
          )}
          <Button
            size="sm"
            borderRadius="full"
            bg="accent"
            color="accentContrast"
            _hover={{ opacity: 0.9 }}
            onClick={handleBackToLibrary}
          >
            返回書庫
          </Button>
        </VStack>
      </FullScreen>
    );
  }

  if (!book) {
    return (
      <FullScreen>
        <Spinner aria-label="載入書籍中" />
      </FullScreen>
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
