import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { buildListObjectsXml } from './listObjectsXml.fixture';
import { createObjectStorageClient } from './objectStorageClient';

// fetch is mocked, aws4fetch is not: the wire is the real boundary here, so these assert the
// request that was actually formed - method, URL, signed headers - and how the response was
// interpreted. Mocking the signing library instead would leave the one thing worth checking
// (that a signed S3 request is what leaves the process) asserted nowhere. See
// .scratch/phase-1-11-object-storage-migration/issues/02-object-storage-client-on-aws4fetch.md.
const CONFIG = {
  accountId: 'acct-1',
  bucket: 'text-reader',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-example',
  segmentOrigin: 'https://leia.text-reader.workers.dev/',
};

const OBJECT_BASE = 'https://acct-1.r2.cloudflarestorage.com/text-reader';

let fakeFetch;

// The signed Request aws4fetch handed to fetch, as the plain values a test wants to assert.
function requestAt(callIndex = 0) {
  const [request] = fakeFetch.mock.calls[callIndex];
  return {
    method: request.method,
    url: request.url,
    contentType: request.headers.get('content-type'),
    authorization: request.headers.get('authorization'),
    body: request,
  };
}

beforeEach(() => {
  fakeFetch = vi.fn();
  vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createObjectStorageClient', () => {
  describe('get', () => {
    test('reads the key plus a .json suffix from the bucket over a signed request', async () => {
      const stored = { url: 'https://leia.text-reader.workers.dev/book-1/0/voice-a.mp3' };
      fakeFetch.mockResolvedValue(new Response(JSON.stringify(stored), { status: 200 }));
      const client = createObjectStorageClient(CONFIG);

      const result = await client.get('book-1/0/voice-a');

      const request = requestAt();
      expect(request.method).toBe('GET');
      expect(request.url).toBe(`${OBJECT_BASE}/book-1/0/voice-a.json`);
      expect(request.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
      expect(result).toEqual(stored);
    });

    test('resolves undefined for a missing object rather than throwing', async () => {
      fakeFetch.mockResolvedValue(
        new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.get('book-1/0/voice-a')).resolves.toBeUndefined();
    });

    // A misconfigured bucket 404s exactly like a Chunk that has not been generated. Left
    // undistinguished, a typo in R2_BUCKET reads as a Library with no Books and every Book
    // with no audio, and regenerates the lot into a bucket that isn't there.
    test('throws on a 404 that means the bucket is missing, not the object', async () => {
      fakeFetch.mockResolvedValue(
        new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.get('book-1/0/voice-a')).rejects.toThrow(/NoSuchBucket/);
    });

    test('throws on a non-404 error, so a broken store is not read as an empty one', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>AccessDenied</Error>', { status: 403 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.get('book-1/0/voice-a')).rejects.toThrow(/403/);
    });

    test('propagates a network failure', async () => {
      fakeFetch.mockRejectedValue(new Error('network down'));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.get('book-1/0/voice-a')).rejects.toThrow('network down');
    });
  });

  describe('getAudioBytes', () => {
    test('reads the key plus an .mp3 suffix and returns the raw bytes', async () => {
      const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
      fakeFetch.mockResolvedValue(new Response(bytes, { status: 200 }));
      const client = createObjectStorageClient(CONFIG);

      const result = await client.getAudioBytes('book-1/0/voice-a');

      expect(requestAt().url).toBe(`${OBJECT_BASE}/book-1/0/voice-a.mp3`);
      expect(new Uint8Array(result)).toEqual(bytes);
    });

    test('resolves undefined when no audio object exists under the key', async () => {
      fakeFetch.mockResolvedValue(
        new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.getAudioBytes('book-1/0/voice-a')).resolves.toBeUndefined();
    });

    // Three attempts, not aws4fetch's default eleven: this module is on the route the media
    // stack polls during playback, so a slow failure is worse than a fast one.
    test('throws on a server error after a bounded number of retries', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>InternalError</Error>', { status: 500 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.getAudioBytes('book-1/0/voice-a')).rejects.toThrow(/500/);
      expect(fakeFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('put', () => {
    test('writes audio and metadata with content types, returning the playable segment URL', async () => {
      fakeFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const client = createObjectStorageClient(CONFIG);
      const audio = new Blob(['fake-audio']);
      const boundaries = [{ text: '你好', offset: 0, duration: 1000 }];

      const persisted = await client.put('book-1/0/voice-a', {
        audio,
        boundaries,
        durationSeconds: 1.5,
      });

      const audioRequest = requestAt(0);
      expect(audioRequest.method).toBe('PUT');
      expect(audioRequest.url).toBe(`${OBJECT_BASE}/book-1/0/voice-a.mp3`);
      expect(audioRequest.contentType).toBe('audio/mpeg');
      expect(await audioRequest.body.text()).toBe('fake-audio');

      // The url a Listener plays from is the Worker's, never the S3 endpoint the write went to.
      expect(persisted).toEqual({
        url: 'https://leia.text-reader.workers.dev/book-1/0/voice-a.mp3',
        boundaries,
        durationSeconds: 1.5,
      });

      const metadataRequest = requestAt(1);
      expect(metadataRequest.method).toBe('PUT');
      expect(metadataRequest.url).toBe(`${OBJECT_BASE}/book-1/0/voice-a.json`);
      expect(metadataRequest.contentType).toBe('application/json');
      expect(await metadataRequest.body.text()).toBe(JSON.stringify(persisted));
    });

    // Rejected rather than repaired, because deriveSegmentUrl concatenates raw and ticket 04
    // points it at this same variable: a repaired origin here would mean `put` and the Chunk
    // index disagreeing about a value they share.
    test('refuses an origin with no trailing slash instead of quietly repairing it', async () => {
      fakeFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const client = createObjectStorageClient({
        ...CONFIG,
        segmentOrigin: 'https://leia.text-reader.workers.dev',
      });

      await expect(
        client.put('book-1/0/voice-a', {
          audio: new Blob(['fake-audio']),
          boundaries: [],
          durationSeconds: 1.5,
        }),
      ).rejects.toThrow(/SEGMENT_ORIGIN must end with a slash/);
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    test('throws without writing metadata when the audio write fails', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>AccessDenied</Error>', { status: 403 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(
        client.put('book-1/0/voice-a', {
          audio: new Blob(['fake-audio']),
          boundaries: [],
          durationSeconds: 1.5,
        }),
      ).rejects.toThrow(/403/);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('putJson', () => {
    test('writes the data as JSON at the key plus a .json suffix', async () => {
      fakeFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const client = createObjectStorageClient(CONFIG);

      await client.putJson('library/index', [{ bookId: 'book-1', resumeIndex: 0 }]);

      const request = requestAt();
      expect(request.method).toBe('PUT');
      expect(request.url).toBe(`${OBJECT_BASE}/library/index.json`);
      expect(request.contentType).toBe('application/json');
      expect(await request.body.text()).toBe(
        JSON.stringify([{ bookId: 'book-1', resumeIndex: 0 }]),
      );
    });

    test('throws when the write is rejected', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>AccessDenied</Error>', { status: 403 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.putJson('library/index', [])).rejects.toThrow(/403/);
    });
  });

  describe('del', () => {
    test('deletes the literal pathname it was given, adding no suffix', async () => {
      fakeFetch.mockResolvedValue(new Response(null, { status: 204 }));
      const client = createObjectStorageClient(CONFIG);

      await client.del('library/book-1/chunks.json');

      const request = requestAt();
      expect(request.method).toBe('DELETE');
      expect(request.url).toBe(`${OBJECT_BASE}/library/book-1/chunks.json`);
      expect(request.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    });

    test('throws when the delete is rejected', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>AccessDenied</Error>', { status: 403 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.del('book-1/0/voice-a.mp3')).rejects.toThrow(/403/);
    });
  });

  describe('list', () => {
    const audio = {
      key: 'book-1/0/voice-a.mp3',
      lastModified: '2026-08-01T10:00:00.000Z',
      size: 40960,
    };
    const metadata = {
      key: 'book-1/0/voice-a.json',
      lastModified: '2026-08-01T10:00:01.000Z',
      size: 512,
    };
    const page = (options) => new Response(buildListObjectsXml(options), { status: 200 });

    test('lists the bucket under a prefix, as the records callers already receive', async () => {
      fakeFetch.mockResolvedValue(page({ objects: [audio, metadata], prefix: 'book-1/' }));
      const client = createObjectStorageClient(CONFIG);

      const listed = await client.list('book-1/');

      const request = requestAt();
      expect(request.method).toBe('GET');
      expect(request.url).toBe(`${OBJECT_BASE}?list-type=2&prefix=book-1%2F`);
      expect(request.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(listed).toEqual([
        { pathname: 'book-1/0/voice-a.mp3', size: 40960, uploadedAt: '2026-08-01T10:00:00.000Z' },
        { pathname: 'book-1/0/voice-a.json', size: 512, uploadedAt: '2026-08-01T10:00:01.000Z' },
      ]);
    });

    // getUsage and cleanupBlobs list the whole bucket.
    test('lists every key when given no prefix', async () => {
      fakeFetch.mockResolvedValue(page({ objects: [audio] }));
      const client = createObjectStorageClient(CONFIG);

      await client.list();

      expect(requestAt().url).toBe(`${OBJECT_BASE}?list-type=2`);
    });

    // S3 caps a page at 1,000 keys and a 1,983-Chunk Book stores nearly 4,000 objects, so a
    // single-page listing under-reports usage, under-cleans, and leaves deleteBook's cascade
    // orphaning most of a Book's audio. Ticket 09 left this alone because another page was
    // another Advanced Operation against a 2,000/month allowance; on R2 it is a Class A
    // operation against a million, so the only reason not to fix it is gone.
    test('follows the continuation token until the listing is complete', async () => {
      fakeFetch
        .mockResolvedValueOnce(page({ objects: [audio], nextContinuationToken: 'token-2' }))
        .mockResolvedValueOnce(page({ objects: [metadata] }));
      const client = createObjectStorageClient(CONFIG);

      const listed = await client.list('book-1/');

      expect(requestAt(1).url).toBe(
        `${OBJECT_BASE}?list-type=2&prefix=book-1%2F&continuation-token=token-2`,
      );
      expect(listed.map(({ pathname }) => pathname)).toEqual([
        'book-1/0/voice-a.mp3',
        'book-1/0/voice-a.json',
      ]);
    });

    test('stops after the page that carries no token, rather than asking again', async () => {
      fakeFetch.mockResolvedValue(page({ objects: [audio] }));
      const client = createObjectStorageClient(CONFIG);

      await client.list('book-1/');

      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    // The reason list() threw between tickets 02 and 03 rather than resolving []: an empty
    // listing is a plausible answer, so a store that is broken or forbidden would report 0%
    // of the quota used and a clean sweep, both indistinguishable from the truth.
    test('throws rather than reporting an empty bucket when the store rejects the listing', async () => {
      fakeFetch.mockResolvedValue(new Response('<Error>AccessDenied</Error>', { status: 403 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.list('book-1/')).rejects.toThrow(/403/);
    });

    test('throws when the bucket does not exist, which S3 answers with a 404', async () => {
      fakeFetch.mockResolvedValue(
        new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.list('book-1/')).rejects.toThrow(/404/);
    });

    // A short listing has the same shape as a complete one, so under-reporting is invisible
    // in what comes back: getUsage would report a fraction of the store, the cron a clean
    // sweep, and deleteBook would orphan the audio it did not see. The parser stays lenient
    // and reports these; refusing them is this client's job.
    test('throws when a page says it was truncated but offers no way to continue', async () => {
      const truncated = buildListObjectsXml({
        objects: [audio],
        nextContinuationToken: 'token-2',
      }).replace('<NextContinuationToken>token-2</NextContinuationToken>', '');
      fakeFetch.mockResolvedValue(new Response(truncated, { status: 200 }));
      const client = createObjectStorageClient(CONFIG);

      await expect(client.list('book-1/')).rejects.toThrow(/truncated/i);
    });

    // A 200 carrying an error page from something in front of the endpoint parses to zero
    // records, which is indistinguishable from an empty bucket.
    test('throws on a 200 whose body is not a listing, rather than reading it as empty', async () => {
      fakeFetch.mockResolvedValue(
        new Response('<html><body>502 Bad Gateway</body></html>', { status: 200 }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.list('book-1/')).rejects.toThrow(/did not answer with a listing/);
    });

    // A fresh Response per call, because a body can only be read once - reusing one would
    // fail on the second page for a reason that has nothing to do with what is under test.
    test('throws rather than looping forever when the store repeats a continuation token', async () => {
      fakeFetch.mockImplementation(async () =>
        page({ objects: [audio], nextContinuationToken: 'token-2' }),
      );
      const client = createObjectStorageClient(CONFIG);

      await expect(client.list('book-1/')).rejects.toThrow(/repeated its continuation token/);
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration', () => {
    test('takes credentials, bucket and origin from the environment', async () => {
      vi.stubEnv('R2_ACCOUNT_ID', 'acct-1');
      vi.stubEnv('R2_BUCKET', 'text-reader');
      vi.stubEnv('R2_ACCESS_KEY_ID', 'AKIAEXAMPLE');
      vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret-example');
      vi.stubEnv('SEGMENT_ORIGIN', 'https://leia.text-reader.workers.dev/');
      fakeFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const client = createObjectStorageClient();

      const persisted = await client.put('book-1/0/voice-a', {
        audio: new Blob(['fake-audio']),
        boundaries: [],
        durationSeconds: 1.5,
      });

      expect(requestAt().url).toBe(`${OBJECT_BASE}/book-1/0/voice-a.mp3`);
      expect(persisted.url).toBe('https://leia.text-reader.workers.dev/book-1/0/voice-a.mp3');
    });

    // Constructing an unconfigured client is allowed on purpose: every consumer builds its
    // default one at module scope, so throwing there would break importing the module rather
    // than using it. The failure lands on the call instead - loudly, and never as an empty
    // result that reads like an empty store.
    test('constructs without configuration, then fails at the first call naming what is missing', async () => {
      const client = createObjectStorageClient();

      await expect(client.get('book-1/0/voice-a')).rejects.toThrow(
        /R2_ACCOUNT_ID.*R2_BUCKET.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/s,
      );
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    test('names only the settings that are actually missing', async () => {
      const { segmentOrigin: _origin, bucket: _bucket, ...rest } = CONFIG;
      const client = createObjectStorageClient(rest);

      await expect(client.del('book-1/0/voice-a.mp3')).rejects.toThrow(/R2_BUCKET/);
      await expect(client.del('book-1/0/voice-a.mp3')).rejects.not.toThrow(/R2_ACCOUNT_ID/);
    });

    test('refuses to write audio with no segment origin, rather than storing an S3 URL', async () => {
      const { segmentOrigin: _origin, ...rest } = CONFIG;
      const client = createObjectStorageClient(rest);

      await expect(
        client.put('book-1/0/voice-a', {
          audio: new Blob(['fake-audio']),
          boundaries: [],
          durationSeconds: 1.5,
        }),
      ).rejects.toThrow(/SEGMENT_ORIGIN/);
      expect(fakeFetch).not.toHaveBeenCalled();
    });
  });
});
