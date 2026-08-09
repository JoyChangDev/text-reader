import { NextResponse } from 'next/server';

import { deleteBook, getBook, updateResumeIndex } from '@/app/_lib/libraryService';

export async function GET(request, { params }) {
  const { bookId } = await params;

  try {
    const book = await getBook(bookId);
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    return NextResponse.json(book);
  } catch (error) {
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
