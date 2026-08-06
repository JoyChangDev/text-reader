import { NextResponse } from 'next/server';

import { readBookAudio } from '@/app/_lib/bookAudio';
import { buildEventPlaylist, toPlaylistSegments } from '@/app/_lib/hlsPlaylist';
import { parsePlaylistStart } from '@/app/_lib/playlistStart';

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
    const book = await readBookAudio({ bookId, voice });
    if (!book) {
      return NextResponse.json({ error: 'book not found' }, { status: 404 });
    }

    // Validated against this Book's length, so it has to come after the lookup.
    const { from, error } = parsePlaylistStart(searchParams.get('from'), {
      chunkCount: book.chunks.length,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return new NextResponse(buildEventPlaylist(toPlaylistSegments(book.chunkAudio), { from }), {
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
