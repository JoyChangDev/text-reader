'use client';
import { useState } from 'react';

import AudioPlayer from './_components/AudioPlayer';
import BookUploader from './_components/BookUploader';

export default function Home() {
  const [book, setBook] = useState(null);

  if (!book) {
    return <BookUploader onReady={setBook} />;
  }

  return <AudioPlayer bookId={book.bookId} chunks={book.chunks} />;
}
