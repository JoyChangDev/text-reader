import { NextResponse } from 'next/server';

import { getBook, updateResumeIndex } from '@/app/_lib/libraryService';

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
  const { resumeIndex } = await request.json();

  if (resumeIndex === undefined || resumeIndex === null) {
    return NextResponse.json({ error: 'resumeIndex is required' }, { status: 400 });
  }

  try {
    const book = await updateResumeIndex(bookId, resumeIndex);
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    return NextResponse.json(book);
  } catch (error) {
    console.error('Updating the resume position failed', error);
    return NextResponse.json({ error: 'Updating the resume position failed' }, { status: 502 });
  }
}
