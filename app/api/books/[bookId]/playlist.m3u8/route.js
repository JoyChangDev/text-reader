import { NextResponse } from 'next/server';

import { readBookAudio } from '@/app/_lib/bookAudio';
import { buildEventPlaylist, toPlaylistSegments } from '@/app/_lib/hlsPlaylist';

// The EVENT playlist a Book is played from: one lookup, one pure builder, no generation.
// Keyed by (Book, voice) to match the cache key audioGenerationService.js already uses.
export async function GET(request, { params }) {
  const { bookId } = await params;
  const voice = new URL(request.url).searchParams.get('voice');

  if (!voice) {
    return NextResponse.json({ error: 'voice is required' }, { status: 400 });
  }

  try {
    const book = await readBookAudio({ bookId, voice });
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    return new NextResponse(buildEventPlaylist(toPlaylistSegments(book.chunkAudio)), {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        // An EVENT playlist grows: the media stack re-fetches this URL to discover
        // segments added since it last looked, and a cached copy would freeze the Book
        // at whatever length it had on the first request.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Building the playlist failed', error);
    return NextResponse.json({ error: 'Building the playlist failed' }, { status: 502 });
  }
}
