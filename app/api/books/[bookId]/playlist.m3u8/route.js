import { NextResponse } from 'next/server';

import { readBookAudio } from '@/app/_lib/bookAudio';
import { buildEventPlaylist, toPlaylistSegments } from '@/app/_lib/hlsPlaylist';
import { BOOK_INCOMPLETE } from '@/app/_lib/libraryService';

// The EVENT playlist a Book is played from: one lookup, one pure builder, no generation.
// Keyed by (Book, voice) to match the cache key audioGenerationService.js already uses.
// `from` optionally starts it part-way in, for a Listener who jumped past a stretch that
// was never narrated (see ticket 07).
export async function GET(request, { params }) {
  const { bookId } = await params;
  const { searchParams } = new URL(request.url);
  const voice = searchParams.get('voice');

  if (!voice) {
    return NextResponse.json({ error: 'voice is required' }, { status: 400 });
  }

  try {
    const book = await readBookAudio({ bookId, voice, from: searchParams.get('from') });
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }
    if (book.error) {
      return NextResponse.json({ error: book.error }, { status: 400 });
    }
    // The Chunk index could not be read, which since ticket 17 has no second opinion behind
    // it. Answering 502 rather than serving what an unnarrated Book would serve: an empty
    // playlist is a truthful answer for a Book with no audio and a lie for a store that is
    // down, and the Listener can act on one of those.
    if (book.unavailable) {
      return NextResponse.json({ error: 'the Chunk index could not be read' }, { status: 502 });
    }

    return new NextResponse(
      buildEventPlaylist(toPlaylistSegments(book.chunkAudio), { from: book.from }),
      {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          // An EVENT playlist grows: the media stack re-fetches this URL to discover
          // segments added since it last looked, and a cached copy would freeze the Book
          // at whatever length it had on the first request.
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      },
    );
  } catch (error) {
    // The same 409 the manifest route answers, and for the same reason — but this route can
    // only reach it for a Book indexed before addBook recorded `totalChunks`, which is the
    // one case where it still reads the Book's text. For every other Book it takes the
    // length off the Library index entry and never opens the chunks blob (ticket 12), so it
    // cannot tell an incomplete Book from an unnarrated one and does not pay a read per poll
    // to find out. Nothing is lost: opening the Book fails at /api/library/[bookId] first,
    // and no player is ever mounted against it.
    if (error.code === BOOK_INCOMPLETE) {
      console.error('The book is in the library index but its text was never stored', error);
      return NextResponse.json({ error: 'book is incomplete' }, { status: 409 });
    }

    console.error('Building the playlist failed', error);
    return NextResponse.json({ error: 'Building the playlist failed' }, { status: 502 });
  }
}
