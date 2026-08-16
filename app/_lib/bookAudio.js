import { readIndexedRun } from './chunkIndex';
import { getBookSummary, readBookChunks } from './libraryService';
import { parsePlaylistStart } from './playlistStart';
import { createChunkIndexClient } from './redisChunkIndex';

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
// Since ticket 17 there is one source: the Chunk index. The Blob scan behind it was deleted
// rather than taught to report the whole Book, because it costs one storage read per Chunk —
// the cost ticket 08's stage 2 removed from this path. An index that cannot be read is
// therefore an outage with no second opinion, and this reports it as one.

// The manifest needs a Sentence span per placed Chunk; the playlist needs none at all.
// Attaching them is therefore a second read, and it is made only for the route that will
// use it — the cues hash is ~130-450 KB against ~36 KB for durations on a 2,000-Chunk Book,
// so putting it on the continuously polled path would undo most of this ticket.
//
// A placed Chunk with no stored cues fails the whole lookup rather than reporting that Chunk
// as having no Sentences. Its audio is on the timeline either way, so the alternative is a
// stretch of the Book that plays with no highlighting and no way to notice — durations and
// cues are written in the same pipeline, so the two disagreeing means the index is damaged,
// not that the Chunk has nothing to say.
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

// The Chunk index is the only source now. Ticket 17 deleted the Blob scan behind it rather
// than pay there for the whole-Book accuracy the manifest needs: the scan costs one storage
// read per Chunk, which is what ticket 08 spent a week removing from this path.
//
// So a read that fails has to be told apart from a Book nobody has narrated, and they arrive
// as different values rather than as the same empty answer:
//
//   readIndex -> undefined           Redis said nothing. An outage, or no credentials.
//   readIndex -> { durations: {} }   Redis answered. This Book has no narration yet.
//
// `orMiss` deliberately collapses a miss and a failure inside the client, so this is the
// level at which the difference still exists. Losing it would make an outage look like an
// empty Book, and an empty Book is a thing the app cheerfully plays nothing of.
async function readChunkAudio(chunkIndexClient, { bookId, voice, chunkCount, needsCues }) {
  const index = await chunkIndexClient.readIndex({ bookId, voice });
  if (!index) return undefined;

  const run = readIndexedRun(index, { bookId, voice, chunkCount });
  if (!run) return undefined;

  if (!needsCues) return run;

  // Durations without their cues used to send the lookup back to Blob, which carried the raw
  // boundaries the spans could be rebuilt from. Nothing carries them now, so this is reported
  // as an unusable index rather than as a Book whose Chunks have no Sentences: the two hashes
  // are written by the same pipeline, so disagreeing means damage, and answering with silent
  // un-highlighted playback would hide it. The rebuild script is the repair.
  return withIndexedCues(chunkIndexClient, run, { bookId, voice });
}

const defaultClients = { chunkIndexClient: createChunkIndexClient() };

// Whether this lookup has to pull the Book's text across the network, and why.
//
// The manifest does: bookManifest counts Sentence ordinals from the Chunk text. The
// playlist wants one integer — how long the Book
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
// `{ unavailable }` when the Chunk index could not be read at all, and otherwise the Chunk
// audio — alongside the Book's text, for the caller that asked for cues and paid for it.
//
// `unavailable` exists because the alternative is worse than an error: with no Blob scan to
// fall back to, an unreadable index and a Book nobody has narrated would both arrive as
// "nothing is placed", and the routes would serve a well-formed empty playlist for an outage.
// A Listener would see a Book that opens and plays nothing, which is the shape of defect
// phase 1.11's ticket 06 was filed about.
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
    chunkCount,
    needsCues,
  });
  if (!chunkAudio) {
    return { unavailable: true };
  }

  return { chunks, chunkAudio, from };
}
