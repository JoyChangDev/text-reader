import { AwsClient } from 'aws4fetch';

import { parseListObjectsXml } from './listObjectsXml';
import { requireSegmentOrigin } from './segmentOrigin';

// Wraps Cloudflare R2's S3-compatible API — the only file in the app that talks to a storage
// provider. See
// .scratch/phase-1-11-object-storage-migration/issues/02-object-storage-client-on-aws4fetch.md,
// and .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md for the seam
// itself. Audio and its boundary metadata are stored as two objects under a deterministic
// pathname derived from the cache key, so a later `get` can find them again.
//
// Signing is aws4fetch rather than @aws-sdk/client-s3 because this module is imported
// transitively by the playlist route, which the media stack re-fetches continuously during
// playback: the SDK's megabytes and cold start would land on the one path phases 1.8-1.10
// were spent making reliable in the background. The price is that ListObjectsV2 comes back
// as XML, which listObjectsXml.js parses.

const metadataPathname = (key) => `${key}.json`;
const audioPathname = (key) => `${key}.mp3`;

// R2 speaks path-style S3 on a per-account host, and signs against a fixed region.
const R2_REGION = 'auto';
const r2Endpoint = (accountId) => `https://${accountId}.r2.cloudflarestorage.com`;

// SigV4 signs the canonical URI, so the key has to be encoded before it is signed rather
// than left to whatever the runtime does with the URL. Separators stay separators: a
// pathname is `<bookId>/<chunkIndex>/<voice>.mp3`, not one opaque segment.
const encodeKey = (pathname) => pathname.split('/').map(encodeURIComponent).join('/');

// Segments were served with a long max-age under the previous provider, and the Worker
// passes stored headers through rather than inventing them (see workers/segments/README.md),
// so the value has to be set at write time or playback loses caching it already had.
const AUDIO_CACHE_CONTROL = 'public, max-age=2592000';

// aws4fetch retries a 5xx or a 429 ten times by default, backing off exponentially from 50ms
// — up to about half a minute held open. This module is on the playlist route the media stack
// re-fetches during playback, where a request that eventually fails slowly is worse than one
// that fails: the route has its own fallback, and phases 1.8-1.10 were spent on not stalling
// there. Two retries covers a blip and caps the delay at a few hundred milliseconds.
const RETRIES = 2;

// edge-tts hands back a Blob, and which Blob implementation that is depends on the runtime.
// A Request built by undici accepts Node's and silently stringifies a foreign one to the
// nine bytes "undefined" — an upload that succeeds and plays as nothing. Reading the Blob to
// bytes here makes the write independent of that, at no cost: it is already wholly in memory,
// and audioGenerationService has read the same bytes to measure the duration.
const toBytes = (body) => (typeof body?.arrayBuffer === 'function' ? body.arrayBuffer() : body);

const ENV_NAMES = {
  accountId: 'R2_ACCOUNT_ID',
  bucket: 'R2_BUCKET',
  accessKeyId: 'R2_ACCESS_KEY_ID',
  secretAccessKey: 'R2_SECRET_ACCESS_KEY',
};

function missingSettings(resolved, required) {
  return required.filter((name) => !resolved[name]).map((name) => ENV_NAMES[name]);
}

// The four the S3 endpoint cannot be addressed without. The segment origin is not among them:
// it names a different host entirely, is shared with the Chunk index, and is required only by
// `put` — the one method that has to name a URL a Listener will play from. It lives in
// segmentOrigin.js for that reason.
const STORE_SETTINGS = ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey'];

export function createObjectStorageClient(overrides = {}) {
  // Resolved per call rather than at construction. Every consumer builds its default client
  // at module scope, so reading the environment there would fix whatever was set at import
  // time and would turn an unconfigured environment into an import-time crash — including in
  // the test suite, which imports these modules with no credentials at all. An absent
  // configuration instead fails at the seam, loudly, and never as an empty result: a `get`
  // that resolved undefined would read as "this Chunk isn't generated yet", and a `list` that
  // resolved [] would read as an empty store.
  function settings(required) {
    const {
      accountId = process.env.R2_ACCOUNT_ID,
      bucket = process.env.R2_BUCKET,
      accessKeyId = process.env.R2_ACCESS_KEY_ID,
      secretAccessKey = process.env.R2_SECRET_ACCESS_KEY,
    } = overrides;

    const resolved = { accountId, bucket, accessKeyId, secretAccessKey };
    const missing = missingSettings(resolved, required);
    if (missing.length > 0) {
      throw new Error(`Object storage is not configured: set ${missing.join(', ')}.`);
    }

    return resolved;
  }

  // Held across calls, because an AwsClient carries the cache of derived signing keys: the
  // four chained HMACs that turn the secret into a date/region/service key. A fresh instance
  // per request re-derives all four every time, which readCachedChunks would pay sixteen
  // times over per batch on the playlist route. Keyed by the credentials so a rotated key or
  // a test's overrides can't be served by a client signing with the previous secret.
  let signer;
  function signerFor({ accessKeyId, secretAccessKey }) {
    if (signer?.accessKeyId !== accessKeyId || signer?.secretAccessKey !== secretAccessKey) {
      signer = new AwsClient({
        accessKeyId,
        secretAccessKey,
        service: 's3',
        region: R2_REGION,
        retries: RETRIES,
      });
    }

    return signer;
  }

  // One signed request against one object. `pathname` is a literal key, already suffixed.
  async function request(pathname, { method, body, contentType, cacheControl } = {}) {
    const { accountId, bucket, accessKeyId, secretAccessKey } = settings(STORE_SETTINGS);
    const aws = signerFor({ accessKeyId, secretAccessKey });

    const headers = {};
    if (contentType) headers['content-type'] = contentType;
    if (cacheControl) headers['cache-control'] = cacheControl;

    // S3 answers 411 MissingContentLength to a PUT that arrives without this header, and
    // nothing on this path guarantees one: it is added by whichever runtime ends up sending
    // the request, at the wire rather than onto the Headers object, so nothing here can even
    // see whether it happened. Node's fetch adds it for a string body of any size; Vercel's
    // did not for a ~2 MB one, which is how a Book's chunks blob 411'd while the smaller
    // index blob written moments earlier went through. Set explicitly so the framing stops
    // depending on the runtime at all.
    //
    // The string is encoded first and the count taken from the bytes, never from
    // `String.length`: the largest thing written is a Book's chunks blob, mostly CJK text at
    // 3 bytes per character, so a character count would understate it threefold and truncate
    // the object. Sending the same bytes that were counted also removes any second chance to
    // disagree about the encoding.
    //
    // Safe to set by hand because aws4fetch lists content-length in UNSIGNABLE_HEADERS, so
    // it never reaches the signature - read from the installed source, not assumed.
    const payload = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    if (payload !== undefined && payload !== null) {
      headers['content-length'] = String(payload.byteLength);
    }

    return aws.fetch(`${r2Endpoint(accountId)}/${bucket}/${encodeKey(pathname)}`, {
      method,
      body: payload,
      headers,
    });
  }

  // One page of ListObjectsV2. Addressed at the bucket rather than at a key, which is why it
  // does not go through `request` above: the query string is the whole of the request, and
  // aws4fetch signs it as part of the canonical request, so it has to be on the URL before
  // signing rather than appended after.
  async function listPage(prefix, continuationToken) {
    const { accountId, bucket, accessKeyId, secretAccessKey } = settings(STORE_SETTINGS);
    const aws = signerFor({ accessKeyId, secretAccessKey });

    const url = new URL(`${r2Endpoint(accountId)}/${bucket}`);
    url.searchParams.set('list-type', '2');
    if (prefix) url.searchParams.set('prefix', prefix);
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);

    const response = await aws.fetch(url.toString(), { method: 'GET' });
    await throwUnlessOk(response, 'list');

    const body = await response.text();
    const page = parseListObjectsXml(body);

    // Two ways a 200 can carry an answer that is short rather than complete, and both are
    // invisible in the records themselves — a listing missing half its keys has the same
    // shape as one that had half that many. Left unchecked they are the failure this whole
    // ticket is about: getUsage reports a fraction of the store, the cleanup cron reports a
    // clean sweep, and deleteBook's cascade orphans the audio it did not see, with nothing
    // left to notice because the Book is already out of the index.
    //
    // The parser stays lenient by design and reports these rather than throwing on them, so
    // that a caller which only wants what could be read still can. This one does not.
    if (!page.isListing) {
      throw new Error(`Object storage list did not answer with a listing: ${body.slice(0, 500)}`);
    }

    if (page.isTruncated && !page.nextContinuationToken) {
      throw new Error(
        'Object storage list was truncated but returned no continuation token, so the rest of the listing is unreachable.',
      );
    }

    return page;
  }

  // The one behaviour that does not port from @vercel/blob for free: its get() resolved null
  // on a 404, while S3 answers with an error response. readCachedChunks' "this Chunk isn't
  // generated yet" branch, libraryService's empty-index path and getBook's snapshot fallback
  // all read absence as undefined. Anything other than a 404 still throws, so a store that is
  // broken or forbidden is never mistaken for a store that is empty.
  //
  // A 404 alone is not enough to conclude that, because S3 also answers 404 for NoSuchBucket:
  // a typo in R2_BUCKET or R2_ACCOUNT_ID would make every read resolve undefined, which reads
  // as a Library with no Books and a Book with no audio, and regenerates the lot into a
  // bucket that isn't there. The XML body distinguishes the two, so it is read rather than
  // discarded — the cost is parsing a short body on the "not generated yet" path, which is
  // already the path that decided not to play anything.
  async function getObject(pathname) {
    const response = await request(pathname, { method: 'GET' });
    if (response.status === 404) {
      const body = await response.text().catch(() => '');
      if (body.includes('<Code>NoSuchBucket</Code>')) {
        throw new Error(`Object storage read failed with 404: ${body.slice(0, 500)}`);
      }

      return undefined;
    }

    await throwUnlessOk(response, 'read');
    return response;
  }

  async function putObject(pathname, body, contentType, cacheControl) {
    const response = await request(pathname, { method: 'PUT', body, contentType, cacheControl });
    await throwUnlessOk(response, 'write');
  }

  return {
    async get(key) {
      const response = await getObject(metadataPathname(key));
      return response ? response.json() : undefined;
    },

    async put(key, { audio, boundaries, durationSeconds }) {
      // Writes go to the S3 endpoint, reads to the Worker, so the URL that goes into stored
      // metadata cannot be the one just written to — it would put an unplayable address into
      // the Chunk's own <bookId>/<chunkIndex>/<voice>.json and into everything that trusts
      // stored metadata. Resolved up front so a missing or slashless origin fails before
      // either object is written rather than after the audio has landed. Ticket 04 makes
      // this same value the Chunk index's base.
      const origin = requireSegmentOrigin(overrides.segmentOrigin);

      await putObject(audioPathname(key), await toBytes(audio), 'audio/mpeg', AUDIO_CACHE_CONTROL);

      const persisted = {
        url: `${origin}${audioPathname(key)}`,
        boundaries,
        durationSeconds,
      };
      await putObject(metadataPathname(key), JSON.stringify(persisted), 'application/json');

      return persisted;
    },

    // Reads back the raw MP3 bytes already stored under key, for the lazy-remeasurement
    // path in audioGenerationService.js — a cache hit predating durationSeconds needs
    // the original audio to measure without resynthesizing it.
    async getAudioBytes(key) {
      const response = await getObject(audioPathname(key));
      return response ? response.arrayBuffer() : undefined;
    },

    // A generic counterpart to get() for callers that only need to persist plain JSON
    // under a key (e.g. libraryService.js's index/chunks blobs) rather than the
    // audio+boundaries pair get/put above are specifically shaped for.
    async putJson(key, data) {
      await putObject(metadataPathname(key), JSON.stringify(data), 'application/json');
    },

    // Unlike get/put's key (a cache key mapped through metadataPathname/audioPathname),
    // del/list operate on literal pathnames, e.g. as returned by list() itself.
    async del(pathname) {
      const response = await request(pathname, { method: 'DELETE' });
      await throwUnlessOk(response, 'delete');
    },

    // Every key under `prefix`, or the whole bucket without one. Pages are followed to the
    // end rather than stopping at S3's 1,000-key cap: a 1,983-Chunk Book stores nearly 4,000
    // objects, so a single page would under-report usage, under-clean, and leave deleteBook's
    // cascade orphaning most of a Book's audio with nothing left to notice. Ticket 09 left
    // that unfixed because a page was an Advanced Operation against a 2,000/month allowance;
    // on R2 it is a Class A operation against a million.
    //
    // Sequential rather than parallel because each page's token comes out of the one before,
    // and neither caller is on a request path a Listener waits on — the cleanup cron and the
    // Library's delete.
    async list(prefix) {
      const objects = [];
      let continuationToken;

      do {
        const page = await listPage(prefix, continuationToken);
        objects.push(...page.objects);

        // A store that answered with the token it was just given would spin here forever,
        // and both callers are things that must finish — the daily cron and the Library's
        // delete. Cheaper to refuse than to diagnose a request that never returns.
        if (
          page.nextContinuationToken !== undefined &&
          page.nextContinuationToken === continuationToken
        ) {
          throw new Error('Object storage list repeated its continuation token.');
        }

        continuationToken = page.nextContinuationToken;
      } while (continuationToken);

      return objects;
    },
  };
}

// S3 puts the reason in an XML body, and losing it makes a 403 from an expired key
// indistinguishable from a 403 from a wrong bucket. Truncated because the body is
// occasionally an HTML error page from something in front of the endpoint.
async function throwUnlessOk(response, what) {
  if (response.ok) return;

  const detail = await response.text().catch(() => '');
  throw new Error(
    `Object storage ${what} failed with ${response.status}: ${detail.slice(0, 500)}`.trim(),
  );
}
