import { NextResponse } from 'next/server';

import { readBookAudio } from '@/app/_lib/bookAudio';
import { buildBookManifest } from '@/app/_lib/bookManifest';

// The absolute-time Sentence spans the client turns into metadata cues, alongside the
// playlist route's segments and keyed by the same (Book, voice). Read-only, like it, and
// it takes the same `from` — a cue time only means anything against the playlist the
// element is actually playing (see ticket 07).
export async function GET(request, { params }) {
  const { bookId } = await params;
  const { searchParams } = new URL(request.url);
  const voice = searchParams.get('voice');

  if (!voice) {
    return NextResponse.json({ error: 'voice is required' }, { status: 400 });
  }

  try {
    // The only route that needs Sentence cues, and so the only one that pays for them —
    // the playlist reads durations alone (see ticket 08's stage 2).
    const book = await readBookAudio({
      bookId,
      voice,
      from: searchParams.get('from'),
      needsCues: true,
    });
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

    return NextResponse.json(buildBookManifest(book, { from: book.from }), {
      // A Book's cue set grows as Chunks generate, so a cached manifest would leave the
      // client permanently short of Sentences.
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Building the manifest failed', error);
    return NextResponse.json({ error: 'Building the manifest failed' }, { status: 502 });
  }
}
