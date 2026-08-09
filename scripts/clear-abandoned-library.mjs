import { Redis } from '@upstash/redis';
import { AwsClient } from 'aws4fetch';

// One-time cutover script — see
// .scratch/phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md ("The data
// is abandoned, not migrated"). Every Book the app knows about today is test material whose
// audio now lives nowhere reachable — nothing was copied to R2 — so this drops the index and
// the Redis entries that still describe those Books. It touches no audio bytes: R2 has none
// yet, and the old Vercel store is left intact per that ticket, which this cannot address
// anyway since ticket 02 replaced that client entirely.
//
// Duplicates the handful of key names and the R2 request-signing app/_lib/objectStorageClient.js
// already defines, rather than importing that module: it uses ESM `export`/`import` syntax
// that only Next's bundler can load, and this is a plain Node script run standalone — the
// same tradeoff scripts/generate-voice-samples.mjs made for AVAILABLE_VOICES. Only get/put/
// delete on known keys are needed here, so unlike the real client this has no reason to sign
// a list request.
//
// Run with real credentials on the environment:
//   npm run clear-abandoned-library

const R2_REGION = 'auto';
const r2Endpoint = (accountId) => `https://${accountId}.r2.cloudflarestorage.com`;
const encodeKey = (pathname) => pathname.split('/').map(encodeURIComponent).join('/');

// Same cap objectStorageClient.js sets, for the same reason: aws4fetch otherwise retries a
// 5xx ten times, backing off to about half a minute held open per call.
const RETRIES = 2;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Set it in the environment this runs with.`);
  return value;
}

function r2Client() {
  const base = `${r2Endpoint(requireEnv('R2_ACCOUNT_ID'))}/${requireEnv('R2_BUCKET')}`;
  const aws = new AwsClient({
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: R2_REGION,
    retries: RETRIES,
  });

  return {
    async get(pathname) {
      const response = await aws.fetch(`${base}/${encodeKey(pathname)}`, { method: 'GET' });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`GET ${pathname} failed with ${response.status}`);
      return response.json();
    },
    async put(pathname, data) {
      const response = await aws.fetch(`${base}/${encodeKey(pathname)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error(`PUT ${pathname} failed with ${response.status}`);
    },
    // 404 is not a failure: the point is that the key is gone either way, and a run resumed
    // after a crash must not fail on what it already deleted.
    async del(pathname) {
      const response = await aws.fetch(`${base}/${encodeKey(pathname)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        throw new Error(`DELETE ${pathname} failed with ${response.status}`);
      }
    },
  };
}

// Everything the Chunk index holds, found by pattern rather than derived from the Library
// index, because at cutover the two do not describe the same set of Books. R2's index is
// empty or nearly so — nothing has written a byte there from the app — while Redis still
// carries every hash the Vercel-era Books wrote. Enumerating from the index would clear
// nothing and report success.
//
// `book:*` is the whole of what redisChunkIndex.js writes (`book:<bookId>:<voice>:durations`
// and `:cues`), and `library:resume` is the whole of what redisResumePosition.js writes, so
// between them this is every key the app owns.
async function clearRedis(redis) {
  let cursor = '0';
  let cleared = 0;

  do {
    const [next, keys] = await redis.scan(cursor, { match: 'book:*', count: 500 });
    if (keys.length > 0) {
      await redis.del(...keys);
      cleared += keys.length;
    }
    cursor = next;
  } while (cursor !== '0');

  await redis.del('library:resume');
  console.log(`Cleared ${cleared} Chunk index key(s) and every stored resume position.`);
}

// The per-Book blobs libraryService.js writes alongside the index, which the index is the
// only record of — so unlike Redis these do have to be enumerated from it.
async function clearLibraryBlobs(storage) {
  const index = (await storage.get('library/index.json')) ?? [];
  console.log(`Library index names ${index.length} Book(s).`);

  for (const { bookId } of index) {
    await storage.del(`library/${bookId}/chunks.json`);
    await storage.del(`library/${bookId}/resume.json`);
    console.log(`Cleared blobs for ${bookId}`);
  }

  await storage.put('library/index.json', []);
  console.log('Library index reset to [].');
}

async function main() {
  const redis = new Redis({
    url: requireEnv('KV_REST_API_URL'),
    token: requireEnv('KV_REST_API_TOKEN'),
  });

  await clearLibraryBlobs(r2Client());
  await clearRedis(redis);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
