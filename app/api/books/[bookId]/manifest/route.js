import { NextResponse } from 'next/server';

import { readBookAudio } from '@/app/_lib/bookAudio';
import { buildBookManifest } from '@/app/_lib/bookManifest';

// The absolute-time Sentence spans the client turns into metadata cues, alongside the
// playlist route's segments and keyed by the same (Book, voice). Read-only, like it.
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

    return NextResponse.json(buildBookManifest(book), {
      // A Book's cue set grows as Chunks generate, so a cached manifest would leave the
      // client permanently short of Sentences.
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Building the manifest failed', error);
    return NextResponse.json({ error: 'Building the manifest failed' }, { status: 502 });
  }
}
