import { NextResponse } from 'next/server';

import { addBook, listBooks } from '@/app/_lib/libraryService';

export async function GET() {
  try {
    const books = await listBooks();
    return NextResponse.json({ books });
  } catch (error) {
    console.error('Listing the library failed', error);
    return NextResponse.json({ error: 'Listing the library failed' }, { status: 502 });
  }
}

export async function POST(request) {
  const { bookId, title, chunks } = await request.json();

  if (!bookId || !title || !chunks) {
    return NextResponse.json({ error: 'bookId, title, and chunks are required' }, { status: 400 });
  }

  try {
    const book = await addBook({ bookId, title, chunks });
    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    console.error('Adding the book to the library failed', error);
    return NextResponse.json({ error: 'Adding the book to the library failed' }, { status: 502 });
  }
}
