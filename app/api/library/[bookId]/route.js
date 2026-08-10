import { NextResponse } from 'next/server';

import { BOOK_INCOMPLETE, deleteBook, getBook, updateResumeIndex } from '@/app/_lib/libraryService';

export async function GET(request, { params }) {
  const { bookId } = await params;

  try {
    const book = await getBook(bookId);
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    return NextResponse.json(book);
  } catch (error) {
    // A Book whose text was never stored is a conflict between the index and the store, not
    // a transport failure: the Book is listed, so 404 would be a lie, and the store answered
    // perfectly well, so the retry a 502 invites can only fail again. The reader needs to
    // tell it apart to say something a Listener can act on (see ticket 06).
    //
    // bookLibrary.js names this same 409 INCOMPLETE_BOOK_STATUS on the client side. The two
    // are written out separately rather than sharing a constant because importing either
    // module into the other is wrong in both directions - this one would pull the object
    // storage client and aws4fetch into the browser bundle.
    if (error.code === BOOK_INCOMPLETE) {
      console.error('The book is in the library index but its text was never stored', error);
      return NextResponse.json({ error: 'book is incomplete' }, { status: 409 });
    }

    console.error('Fetching the book failed', error);
    return NextResponse.json({ error: 'Fetching the book failed' }, { status: 502 });
  }
}

export async function PATCH(request, { params }) {
  const { bookId } = await params;
  const { resumeIndex, resumeSentenceIndex, updatedAt, snapshot } = await request.json();

  if (resumeIndex === undefined || resumeIndex === null) {
    return NextResponse.json({ error: 'resumeIndex is required' }, { status: 400 });
  }
  if (resumeSentenceIndex === undefined || resumeSentenceIndex === null) {
    return NextResponse.json({ error: 'resumeSentenceIndex is required' }, { status: 400 });
  }
  // Rejected at the boundary rather than stored: a position with no timestamp can never be
  // compared against a stored one, so it would either be dropped silently or win forever.
  if (!Number.isFinite(updatedAt)) {
    return NextResponse.json({ error: 'updatedAt must be a number' }, { status: 400 });
  }

  try {
    // No 404 for an unknown Book: proving it exists means reading the Library index, which
    // is the Blob operation this whole path exists to stop spending (see ticket 10).
    const position = await updateResumeIndex(bookId, {
      resumeIndex,
      resumeSentenceIndex,
      updatedAt,
      snapshot: snapshot === true,
    });

    return NextResponse.json(position);
  } catch (error) {
    console.error('Updating the resume position failed', error);
    return NextResponse.json({ error: 'Updating the resume position failed' }, { status: 502 });
  }
}

export async function DELETE(request, { params }) {
  const { bookId } = await params;

  try {
    const deleted = await deleteBook(bookId);
    if (!deleted) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    return NextResponse.json(deleted);
  } catch (error) {
    console.error('Deleting the book failed', error);
    return NextResponse.json({ error: 'Deleting the book failed' }, { status: 502 });
  }
}
