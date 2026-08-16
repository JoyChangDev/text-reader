// A per-(Book, voice) index of what audio exists, so the playlist and manifest routes stop
// paying one Blob read per Chunk on every poll. See
// .scratch/phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md.
//
// This file holds the pure half: given what the index returned, work out the run of Chunks
// the playlist can place and where their audio lives. The Redis I/O is in redisChunkIndex.js
// so this stays testable without a client, and so a miss is a plain `undefined` here rather
// than a caching concern threaded through the routes.
//
// The index is a cache, never the source of truth - the per-Chunk Blob metadata stays
// authoritative. An index that is empty, stale, or short under-reports what is generated,
// which degrades to the Blob scan and re-indexes on the next generation rather than losing
// anything.

export const audioPathname = ({ bookId, chunkIndex, voice }) =>
  `${bookId}/${chunkIndex}/${voice}.mp3`;

// Segment URLs are never stored in the index: a key is written to a deterministic pathname,
// so a URL is a pure function of the store's origin and the cache key. Storing them instead
// would put ~110 bytes per Chunk on a path polled continuously - about 220 KB per poll on a
// 2,000-Chunk Book, which is the cost this ticket exists to remove, just moved to Redis.
//
// The origin is not stored either. Ticket 08 recovered it from a real `put` response, which
// held only while reads and writes shared a host; on R2 the app writes to the S3 endpoint and
// the Listener reads from the Worker, so `base` is configuration - see segmentOrigin.js and
// ticket 04 of phase 1.11.
export function deriveSegmentUrl(base, { bookId, chunkIndex, voice }) {
  return `${base}${audioPathname({ bookId, chunkIndex, voice })}`;
}

// The client hands back hash values as strings from HGETALL but as numbers from HMGET, so
// the coercion is explicit rather than trusted: a string reaching the playlist builder would
// render as #EXTINF:"12.5". A zero or unparseable value is treated as absent - the same
// judgement isPlayableChunk makes about stored metadata, and for the same reason (a zero
// duration silently becomes a zero-length segment).
function toDurationSeconds(value) {
  const durationSeconds = Number(value);
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined;
}

// Cues are stored as bare [start, end] pairs rather than as deriveSentenceSpans' own output,
// which also carries each Sentence's text. The text is already in the Book's chunks blob and
// the manifest never returns it, so storing it would roughly quadruple a hash that the
// manifest reads over the network. A Sentence's identity comes from its ordinal, which
// bookManifest counts from the Chunk text - never from anything stored here.
export function toStoredSpans(spans) {
  return spans.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds]);
}

// The client parses JSON-looking values on some paths and hands them back as strings on
// others, so both shapes have to be accepted rather than one of them trusted. A value that
// is neither is treated as absent: the Chunk falls back to deriving from its Blob
// boundaries, which is the same path a Chunk indexed before cues existed takes.
export function toCueSpans(value) {
  const pairs = typeof value === 'string' ? tryParse(value) : value;
  if (!Array.isArray(pairs)) {
    return undefined;
  }

  return pairs.map(([startSeconds, endSeconds]) => ({ startSeconds, endSeconds }));
}

function tryParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// One entry per Chunk index, `undefined` where the index does not place it.
//
// **Every Chunk the index knows about, not just the run at `from`.** It used to stop at the
// first gap, on the reasoning that the playlist truncates there anyway - true of the playlist
// and false of the manifest, which reports `isGenerated` for the whole Book and is the
// client's only authority on what exists. Stopping early made a narrated Chunk past a gap
// indistinguishable from one that was never narrated, so `canPlaylistReach` could never be
// told that a seek target existed and a re-point could never fire (ticket 17). The playlist is
// unaffected: `buildEventPlaylist` slices from `from` and stops at its own first `null`, so
// the truncation lives there and always did.
//
// It reports the whole Book, including Chunks *before* `from`. Ticket 07 said it already did
// - "Chunks before the start are still reported with their real isGenerated, which is what the
// client's reachability check reads" - and it did not. That matters for the same ticket's
// backward seek: a target before the playlist's start is unreachable by definition, so the
// client has to re-point to it, and it can only know to do that if it is told the Chunk
// exists. `from` decides where the timeline begins, not what counts as narrated;
// `buildEventPlaylist` slices from it and ignores everything earlier.
//
// It costs nothing to look at the rest. `durations` is the whole hash, already in memory from
// one HGETALL; this is a loop bound, not a fetch.
//
// Returns `undefined` only when there is no usable index at all - never merely because the
// Chunk at `from` is missing. Since ticket 17 removed the Blob fallback, `undefined` is what
// tells a route that Redis said nothing, and a Book narrated somewhere other than its start
// must not be able to say that. A Book with nothing narrated yields a run of `undefined`s,
// which is a different answer and reads as a different thing.
//
// `base` is still guarded even though it now comes from configuration and its reader throws:
// this half is pure and takes whatever it is handed, and a run of URLs built on `undefined`
// is exactly the wrong-but-plausible answer the guard exists to refuse.
export function readIndexedRun({ base, durations }, { bookId, voice, chunkCount }) {
  if (!base || !durations) {
    return undefined;
  }

  const run = new Array(chunkCount).fill(undefined);

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const durationSeconds = toDurationSeconds(durations[chunkIndex]);
    if (durationSeconds === undefined) continue;

    run[chunkIndex] = {
      url: deriveSegmentUrl(base, { bookId, chunkIndex, voice }),
      durationSeconds,
    };
  }

  return run;
}
