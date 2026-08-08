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

const audioPathname = ({ bookId, chunkIndex, voice }) => `${bookId}/${chunkIndex}/${voice}.mp3`;

// Segment URLs are never stored in the index: `put` uses addRandomSuffix: false, so a URL is
// a pure function of the store's origin and the cache key. Storing them instead would put
// ~110 bytes per Chunk on a path polled continuously - about 220 KB per poll on a
// 2,000-Chunk Book, which is the cost this ticket exists to remove, just moved to Redis.
//
// The origin is recovered from a real `put` response rather than parsed out of
// BLOB_READ_WRITE_TOKEN or configured by hand: the token's internal format is an
// undocumented implementation detail, and a second env var is a second thing to get wrong.
export function storeBase({ url, pathname }) {
  return url.slice(0, url.length - pathname.length);
}

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

// One entry per Chunk index, `undefined` where the index doesn't place it - the same shape
// readCachedChunks returns, so the routes can't tell which source answered them.
//
// Scans forward from `from` and stops at the first gap, matching the playlist: it truncates
// there, so a Chunk beyond it has no knowable position however complete its audio is. `from`
// is honoured for the same reason the Blob scan honours it - a Listener who jumped over an
// ungenerated stretch (ticket 07) would otherwise stop at the gap they already jumped past.
//
// Returns `undefined` for a miss, meaning "ask Blob", which is deliberately not the same as
// an empty run meaning "nothing is generated". An index that has never been written must not
// be able to convince a route that a fully-narrated Book is empty.
export function readIndexedRun({ base, durations }, { bookId, voice, chunkCount, from = 0 }) {
  if (!base || !durations || toDurationSeconds(durations[from]) === undefined) {
    return undefined;
  }

  const run = new Array(chunkCount).fill(undefined);

  for (let chunkIndex = from; chunkIndex < chunkCount; chunkIndex += 1) {
    const durationSeconds = toDurationSeconds(durations[chunkIndex]);
    if (durationSeconds === undefined) break;

    run[chunkIndex] = {
      url: deriveSegmentUrl(base, { bookId, chunkIndex, voice }),
      durationSeconds,
    };
  }

  return run;
}
