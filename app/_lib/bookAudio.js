import { getCachedChunks } from './audioGenerationService';
import { readIndexedRun } from './chunkIndex';
import { getBookSummary, readBookChunks } from './libraryService';
import { parsePlaylistStart } from './playlistStart';
import { createChunkIndexClient } from './redisChunkIndex';
import { deriveCueSpans } from './sentenceSpans';

// The one lookup both HLS routes make: whatever audio is already cached for one voice, in
// Chunk order, and as much of the Book itself as the caller will actually use. Read-only —
// /api/audio-chunks remains the only thing that generates (see ticket 03).
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
//
// `chunks` is `undefined` on the playlist path, which never paid for the text (ticket 12).
// The early return is what makes that safe, so the two conditions are the same condition:
// needsCues is exactly when needsBookText below is true, and exactly when the text is here.
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

async function readChunkAudio(
  chunkIndexClient,
  { bookId, voice, chunks, chunkCount, from, needsCues },
) {
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

// Whether this lookup has to pull the Book's text across the network, and why.
//
// The manifest does: bookManifest counts Sentence ordinals from the Chunk text, and the
// Blob fallback derives spans from it. The playlist wants one integer — how long the Book
// is — which the Library index entry already records, so it reads the 17 KB index instead
// of a blob that is 1.6 MB on a 4,962-Chunk Book and is re-fetched every ~42 seconds for
// as long as a Listener is listening (ticket 12).
//
// The exception is a Book indexed before addBook recorded `totalChunks`. There is nowhere
// cheap to ask, and an absent count is worse than a slow one: `new Array(undefined)` is a
// one-element run, so a fully narrated Book would serve as a stump of a playlist rather
// than fail. It pays the read it always paid.
function needsBookText({ totalChunks }, needsCues) {
  return needsCues || typeof totalChunks !== 'number';
}

// Returns null for an unknown Book, `{ error }` for a `from` that names no Chunk in it,
// and otherwise the Chunk audio reachable from `from` — alongside the Book's text, for the
// caller that asked for cues and therefore paid for it.
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
  const summary = await getBookSummary(bookId);
  if (!summary) {
    return null;
  }

  const chunks = needsBookText(summary, needsCues) ? await readBookChunks(bookId) : undefined;
  const chunkCount = chunks?.length ?? summary.totalChunks;

  const { from, error } = parsePlaylistStart(requestedFrom, { chunkCount });
  if (error) {
    return { error };
  }

  const chunkAudio = await readChunkAudio(chunkIndexClient, {
    bookId,
    voice,
    chunks,
    chunkCount,
    from,
    needsCues,
  });

  return { chunks, chunkAudio, from };
}
