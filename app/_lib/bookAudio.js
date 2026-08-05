import { getCachedChunks } from './audioGenerationService';
import { getBook } from './libraryService';

// The one lookup both HLS routes make: a Book's Chunk text plus whatever audio is already
// cached for one voice, in Chunk order. Returns null for an unknown Book. Read-only —
// /api/audio-chunks remains the only thing that generates (see ticket 03).
export async function readBookAudio({ bookId, voice }) {
  const book = await getBook(bookId);
  if (!book) {
    return null;
  }

  const chunkAudio = await getCachedChunks({ bookId, voice, chunkCount: book.chunks.length });
  return { chunks: book.chunks, chunkAudio };
}
