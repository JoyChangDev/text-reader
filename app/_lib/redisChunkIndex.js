import { toCueSpans, toStoredSpans } from './chunkIndex';
import { orMiss, redisFromEnv } from './upstashRedis';

// The I/O half of the Chunk index (chunkIndex.js holds the pure half) - see
// .scratch/phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md.
//
// Every method here treats Redis as a cache and never as the source of truth: a read that
// fails is a miss, a write that fails is dropped. The per-Chunk Blob metadata stays
// authoritative, so the worst an unavailable Redis can do is send the routes back to the
// stage 1 Blob scan they used before this existed. Anything stricter would let a Redis
// outage take playback down with it, which is a strictly worse failure than being slow.

// Two hashes per (Book, voice), because their read frequencies differ by orders of
// magnitude: durations is HGETALL'd on every playlist poll, cues is HMGET'd for placed
// Chunks only, and only when the manifest is read.
const durationsKey = ({ bookId, voice }) => `book:${bookId}:${voice}:durations`;
const cuesKey = ({ bookId, voice }) => `book:${bookId}:${voice}:cues`;

// Segment URLs are derivable from the store's origin (see chunkIndex.js), so the origin is
// the one thing the index has to record that isn't per-Chunk. It is global rather than
// per-Book: one store backs every Book, and recording it per-Book would multiply both the
// write and the read for a value that is the same every time.
const ORIGIN_KEY = 'blob:origin';

// redis is injected so tests substitute a fake instead of reaching Upstash, matching how
// audioGenerationService.js takes its storageClient. An absent client is not an error: a
// fresh clone with no credentials gets a client whose reads miss and whose writes drop, so
// the app still plays - just at stage 1's cost.
export function createChunkIndexClient({ redis = redisFromEnv() } = {}) {
  return {
    // What the playlist needs, in one round trip: every indexed duration for this
    // (Book, voice) plus the store origin its segment URLs are derived from.
    async readIndex({ bookId, voice }) {
      if (!redis) return undefined;

      return orMiss('the Chunk index could not be read', async () => {
        const [durations, base] = await redis
          .pipeline()
          .hgetall(durationsKey({ bookId, voice }))
          .get(ORIGIN_KEY)
          .exec();

        return { base, durations };
      });
    },

    // Only the Chunks the playlist actually placed. The whole cues hash is ~130-450 KB on
    // a 2,000-Chunk Book against ~36 KB for durations, so HGETALL'ing it would undo most
    // of what this ticket is for on the one route that needs it.
    async readCues({ bookId, voice }, chunkIndexes) {
      if (!redis) return undefined;
      // HMGET with no field is an error, and there is nothing to ask for anyway.
      if (chunkIndexes.length === 0) return [];

      return orMiss('the Chunk index could not return cues', async () => {
        const [values] = await redis
          .pipeline()
          .hmget(cuesKey({ bookId, voice }), ...chunkIndexes.map(String))
          .exec();

        // Keyed by field name, not by position: the client deserializes HMGET into an
        // object (and into null when every field is missing), so indexing by position
        // would only line up while the Chunks asked for happen to start at 0. A Listener
        // who jumped past an ungenerated stretch asks from `from`, and every cue would
        // have missed - silently, since a missing cue reads as a damaged index.
        return chunkIndexes.map((chunkIndex) => toCueSpans(values?.[chunkIndex]));
      });
    },

    // Called once per generated Chunk. HSET writes a single field atomically, so the
    // look-ahead's parallel writers need no read-modify-write and no retry loop - the
    // property that ruled out keeping this index in Blob, which has no compare-and-swap.
    //
    // The origin is re-SET on every write rather than written once behind an NX. It costs
    // one command per generation (never per poll), and it means a store whose origin ever
    // changes self-heals on the next Chunk instead of serving derived URLs into a store
    // that has moved.
    async writeChunk({ bookId, chunkIndex, voice }, { durationSeconds, spans, base }) {
      if (!redis) return;
      // A duration the playlist could not use would index the Chunk as playable when it
      // isn't, and nothing ever re-reads the index to find out it was wrong. Same rule as
      // isPlayableChunk, applied before the entry exists rather than after.
      if (!(durationSeconds > 0) || !base) return;

      await orMiss('the Chunk index could not be written', () =>
        redis
          .pipeline()
          .hset(durationsKey({ bookId, voice }), { [chunkIndex]: durationSeconds })
          .hset(cuesKey({ bookId, voice }), {
            [chunkIndex]: JSON.stringify(toStoredSpans(spans)),
          })
          .set(ORIGIN_KEY, base)
          .exec(),
      );
    },
  };
}
