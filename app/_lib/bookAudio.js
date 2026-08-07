import { getCachedChunks } from './audioGenerationService';
import { getBook } from './libraryService';
import { parsePlaylistStart } from './playlistStart';

// The one lookup both HLS routes make: a Book's Chunk text plus whatever audio is already
// cached for one voice, in Chunk order. Read-only — /api/audio-chunks remains the only
// thing that generates (see ticket 03).
//
// It owns the `from` contract rather than leaving each route to parse it, because the
// playlist and the manifest have to agree on where the timeline's zero is; a route
// reading it one way and the other reading it another would put every cue at the wrong
// second. Validating it needs the Book's length, so it can only happen after the lookup,
// which is the other reason it lives here rather than in the routes.
//
// Returns null for an unknown Book, `{ error }` for a `from` that names no Chunk in it,
// and otherwise the Book's text alongside the Chunk audio reachable from `from`.
export async function readBookAudio({ bookId, voice, from: requestedFrom }) {
  const book = await getBook(bookId);
  if (!book) {
    return null;
  }

  const { from, error } = parsePlaylistStart(requestedFrom, { chunkCount: book.chunks.length });
  if (error) {
    return { error };
  }

  const chunkAudio = await getCachedChunks({
    bookId,
    voice,
    chunkCount: book.chunks.length,
    from,
  });
  return { chunks: book.chunks, chunkAudio, from };
}
