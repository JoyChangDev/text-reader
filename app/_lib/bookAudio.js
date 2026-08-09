import { getCachedChunks } from './audioGenerationService';
import { readIndexedRun } from './chunkIndex';
import { getBook } from './libraryService';
import { parsePlaylistStart } from './playlistStart';
import { createChunkIndexClient } from './redisChunkIndex';
import { deriveCueSpans } from './sentenceSpans';

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
// It also owns which source answers — the Chunk index or a Blob scan (see ticket 08's
// stage 2). Both produce the same entry shape, so neither route can tell which one it got.

// The manifest needs a Sentence span per placed Chunk; the playlist needs none at all.
// Attaching them is therefore a second read, and it is made only for the route that will
// use it — the cues hash is ~130-450 KB against ~36 KB for durations on a 2,000-Chunk Book,
// so putting it on the continuously polled path would undo most of this ticket.
//
// A placed Chunk with no stored cues sends the whole lookup back to Blob rather than
// reporting that Chunk as having no Sentences. Its audio is on the timeline either way, so
// the alternative is a stretch of the Book that plays with no highlighting and no way to
// notice — durations and cues are written in the same pipeline, so the two disagreeing
// means the index is damaged, not that the Chunk has nothing to say.
async function withIndexedCues(chunkIndexClient, run, { bookId, voice }) {
  const placed = run.flatMap((entry, chunkIndex) => (entry ? [chunkIndex] : []));
  const cues = await chunkIndexClient.readCues({ bookId, voice }, placed);
  if (!cues || cues.some((spans) => !spans)) {
    return undefined;
  }

  const withSpans = [...run];
  placed.forEach((chunkIndex, position) => {
    withSpans[chunkIndex] = { ...run[chunkIndex], spans: cues[position] };
  });

  return withSpans;
}

// What the Blob scan returns carries raw word boundaries, so the manifest's spans have to
// be derived from them here — the index path had them derived once at generation time
// instead. Doing it here is what lets bookManifest see one entry shape whichever source
// answered, and the playlist skips it because it reads no cue.
function withDerivedCues(chunkAudio, chunks, needsCues) {
  if (!needsCues) return chunkAudio;

  return chunkAudio.map((metadata, chunkIndex) =>
    metadata
      ? {
          ...metadata,
          spans: deriveCueSpans({ text: chunks[chunkIndex], boundaries: metadata.boundaries }),
        }
      : undefined,
  );
}

async function readChunkAudio(chunkIndexClient, { bookId, voice, chunks, from, needsCues }) {
  const chunkCount = chunks.length;
  const index = await chunkIndexClient.readIndex({ bookId, voice });
  const run = index && readIndexedRun(index, { bookId, voice, chunkCount, from });

  if (run) {
    const answered = needsCues
      ? await withIndexedCues(chunkIndexClient, run, { bookId, voice })
      : run;
    if (answered) return answered;
  }

  return withDerivedCues(
    await getCachedChunks({ bookId, voice, chunkCount, from }),
    chunks,
    needsCues,
  );
}

const defaultClients = { chunkIndexClient: createChunkIndexClient() };

// Returns null for an unknown Book, `{ error }` for a `from` that names no Chunk in it,
// and otherwise the Book's text alongside the Chunk audio reachable from `from`.
//
// `needsCues` is the manifest route; the playlist route leaves it off. It is a property of
// what the caller will do with the answer rather than of the Book, which is why it is a
// parameter and not something this could work out for itself.
//
// The index client is a second argument rather than part of the request, matching
// libraryService.js and audioGenerationService.js — a test substitutes a fake here instead
// of reaching Upstash, and the two route tests get the same seam.
export async function readBookAudio(
  { bookId, voice, from: requestedFrom, needsCues = false },
  { chunkIndexClient } = defaultClients,
) {
  const book = await getBook(bookId);
  if (!book) {
    return null;
  }

  const { from, error } = parsePlaylistStart(requestedFrom, { chunkCount: book.chunks.length });
  if (error) {
    return { error };
  }

  const chunkAudio = await readChunkAudio(chunkIndexClient, {
    bookId,
    voice,
    chunks: book.chunks,
    from,
    needsCues,
  });

  return { chunks: book.chunks, chunkAudio, from };
}
