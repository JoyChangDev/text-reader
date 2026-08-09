import { Redis } from '@upstash/redis';

// What redisChunkIndex.js and redisResumePosition.js both need from Upstash, in one place
// so the two can't drift about how the client is built or about what a failure means. See
// .scratch/phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md
// (which introduced the Chunk index) and issues/10-resume-position-spends-an-advanced-operation-per-sentence.md
// (which introduced the resume position).

// The credentials arrive under the legacy Vercel KV names, so Redis.fromEnv() does not
// work - it looks for UPSTASH_REDIS_REST_*. The REST client is the right shape for
// serverless; KV_URL/REDIS_URL are TCP connection strings and are deliberately unused.
//
// Absent credentials are not an error: a fresh clone gets an undefined client, and every
// caller treats that as "Redis has nothing to say" rather than as a failure.
export function redisFromEnv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : undefined;
}

// A miss and a failure are the same outcome to every caller, so they are the same code
// path. Logged rather than silent: Redis that has quietly stopped answering looks exactly
// like Redis that was never written, and from outside the only difference is that
// something got slower or a resume position stopped following the Listener around.
//
// `what` names the operation from the caller's own vocabulary - "the Chunk index could not
// be read", "the resume position could not be stored" - because two modules share this and
// an operator reading the logs needs to know which one stopped working. It says nothing
// about what happens next: the fallback differs per call site, and for `remove` there
// isn't one.
export async function orMiss(what, run) {
  try {
    return await run();
  } catch (error) {
    console.warn(`Redis: ${what}`, error);
    return undefined;
  }
}
