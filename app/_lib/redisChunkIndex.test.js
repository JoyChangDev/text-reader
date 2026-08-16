import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createChunkIndexClient } from './redisChunkIndex';

const book = { bookId: 'book-1', voice: 'voice-a' };
const SEGMENT_ORIGIN = 'https://leia.text-reader.workers.dev/';

// A stand-in for @upstash/redis: records the commands issued against it, whether they were
// queued into a pipeline or called directly, and resolves with whatever the test wants them
// to have returned. readIndex is a single command now that the index stores no origin, so
// both shapes have to be here.
function fakeRedis(results = []) {
  const commands = [];
  const pipeline = {
    hgetall: (...args) => (commands.push(['hgetall', ...args]), pipeline),
    hmget: (...args) => (commands.push(['hmget', ...args]), pipeline),
    hset: (...args) => (commands.push(['hset', ...args]), pipeline),
    del: (...args) => (commands.push(['del', ...args]), pipeline),
    exec: vi.fn(async () => results),
  };
  const hgetall = vi.fn(async (...args) => (commands.push(['hgetall', ...args]), results[0]));

  return { commands, hgetall, pipeline: () => pipeline, exec: pipeline.exec };
}

beforeEach(() => {
  vi.stubEnv('SEGMENT_ORIGIN', SEGMENT_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createChunkIndexClient', () => {
  describe('readIndex', () => {
    // One command, where this used to pipeline HGETALL with a GET of a stored origin. The
    // origin is configuration now: reads come from the Worker and writes go to the S3
    // endpoint, so no write response can name the host a Listener plays from.
    test('reads the durations hash in a single command, taking the origin from configuration', async () => {
      const redis = fakeRedis([{ 0: '12.5', 1: '11' }]);
      const client = createChunkIndexClient({ redis });

      const index = await client.readIndex(book);

      expect(redis.commands).toEqual([['hgetall', 'book:book-1:voice-a:durations']]);
      expect(redis.exec).not.toHaveBeenCalled();
      expect(index).toEqual({ base: SEGMENT_ORIGIN, durations: { 0: '12.5', 1: '11' } });
    });

    // The shape @upstash/redis actually returns for a key that is not there, which is every
    // Book before its first Chunk is narrated - Redis drops a hash when its last field goes,
    // so an empty one cannot be observed. Handed on as `null` it fails readIndexedRun's
    // `!durations` guard and both HLS routes call an index they read perfectly well an
    // outage. `{}` for a Book with no narration and `undefined` for a Redis that could not
    // answer are the two answers bookAudio.js is written against (see ticket 18).
    //
    // Asserted here rather than with the `{}` every other test in this suite passes around:
    // `{}` is what this method promises its callers, not what Redis hands it, and a fixture
    // that starts from the promise cannot catch it being broken.
    test('reports a Book that has never been narrated as an index holding nothing', async () => {
      const redis = fakeRedis([null]);

      const index = await createChunkIndexClient({ redis }).readIndex(book);

      expect(index).toEqual({ base: SEGMENT_ORIGIN, durations: {} });
      expect(index.durations).not.toBeNull();
    });

    // The index is a cache, so an unreachable or misbehaving Redis has to look exactly
    // like an index that was never written: a miss, which sends the caller to Blob.
    // Anything else would let a Redis outage take playback down with it.
    test('is a miss rather than an error when Redis fails', async () => {
      const redis = fakeRedis();
      redis.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createChunkIndexClient({ redis }).readIndex(book)).resolves.toBeUndefined();
    });

    test('is a miss when no credentials were configured, so a fresh clone still plays', async () => {
      await expect(createChunkIndexClient({}).readIndex(book)).resolves.toBeUndefined();
    });

    // Deliberately not a miss, unlike everything else that can go wrong here. Falling back
    // would send the playlist to the Blob scan, which answers from URLs stored at generation
    // time - so playback would keep working while quietly paying the per-Chunk read this
    // index exists to remove, and nothing would say why.
    test('fails loudly when the segment origin is missing, rather than degrading quietly', async () => {
      vi.stubEnv('SEGMENT_ORIGIN', '');
      const redis = fakeRedis([{ 0: '12.5' }]);

      await expect(createChunkIndexClient({ redis }).readIndex(book)).rejects.toThrow(
        /SEGMENT_ORIGIN/,
      );
      expect(redis.hgetall).not.toHaveBeenCalled();
    });
  });

  // @upstash/redis deserializes HMGET into an object keyed by FIELD NAME - not into an
  // array in the order the fields were asked for - and JSON.parses each value. Both fakes
  // below mirror that, because a fake returning an array made an indexing bug invisible:
  // reading by position lines up with the field names only while the Chunks asked for
  // start at 0, so every Book played from a later Chunk lost its cues.
  describe('readCues', () => {
    test('fetches only the Chunks it was asked for, never the whole hash', async () => {
      const redis = fakeRedis([{ 3: [[0, 1.5]], 4: [[2, 3]] }]);
      const client = createChunkIndexClient({ redis });

      await client.readCues(book, [3, 4]);

      expect(redis.commands).toEqual([['hmget', 'book:book-1:voice-a:cues', '3', '4']]);
    });

    test('returns spans per requested Chunk, in the order they were asked for', async () => {
      const redis = fakeRedis([{ 3: [[0, 1.5]], 4: [[2, 3]] }]);

      const cues = await createChunkIndexClient({ redis }).readCues(book, [3, 4]);

      expect(cues).toEqual([
        [{ startSeconds: 0, endSeconds: 1.5 }],
        [{ startSeconds: 2, endSeconds: 3 }],
      ]);
    });

    // The regression that the array-shaped fake hid. A Listener who jumped past an
    // ungenerated stretch (ticket 07) reads the Book from a later Chunk, so the fields
    // asked for never start at 0 - and a cue read as missing reads as a damaged index,
    // which sends the whole manifest back to the Blob scan without saying why.
    test('keys the answer by Chunk index, not by position in the request', async () => {
      const redis = fakeRedis([{ 15: [[0, 1.5]], 16: [[2, 3]] }]);

      const cues = await createChunkIndexClient({ redis }).readCues(book, [15, 16]);

      expect(cues).toEqual([
        [{ startSeconds: 0, endSeconds: 1.5 }],
        [{ startSeconds: 2, endSeconds: 3 }],
      ]);
    });

    // The client parses JSON-looking values on some paths and not others, so both shapes
    // have to survive - see the return-type note in ticket 08.
    test('accepts a JSON string as readily as a value the client already parsed', async () => {
      const redis = fakeRedis([{ 3: JSON.stringify([[0, 1.5]]) }]);

      const cues = await createChunkIndexClient({ redis }).readCues(book, [3]);

      expect(cues).toEqual([[{ startSeconds: 0, endSeconds: 1.5 }]]);
    });

    test('reports a Chunk with no stored cues as undefined rather than as no Sentences', async () => {
      const redis = fakeRedis([{ 4: [[2, 3]] }]);

      const cues = await createChunkIndexClient({ redis }).readCues(book, [3, 4]);

      expect(cues[0]).toBeUndefined();
      expect(cues[1]).toEqual([{ startSeconds: 2, endSeconds: 3 }]);
    });

    // The client collapses an all-missing HMGET to null rather than to an object of nulls.
    test('reports every Chunk as uncued when the hash has none of them', async () => {
      const redis = fakeRedis([null]);

      const cues = await createChunkIndexClient({ redis }).readCues(book, [3, 4]);

      expect(cues).toEqual([undefined, undefined]);
    });

    test('asks Redis nothing when no Chunk is placed', async () => {
      const redis = fakeRedis();

      await expect(createChunkIndexClient({ redis }).readCues(book, [])).resolves.toEqual([]);
      expect(redis.exec).not.toHaveBeenCalled();
    });

    test('is a miss rather than an error when Redis fails', async () => {
      const redis = fakeRedis();
      redis.exec.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createChunkIndexClient({ redis }).readCues(book, [3])).resolves.toBeUndefined();
    });
  });

  describe('writeChunk', () => {
    // Two commands, not the three this used to issue: the third re-SET a stored origin on
    // every generated Chunk, and there is no stored origin any more.
    test('writes the duration and the cues in one pipeline, and nothing else', async () => {
      const redis = fakeRedis();
      const client = createChunkIndexClient({ redis });

      await client.writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 12.5, spans: [{ startSeconds: 0, endSeconds: 1.5 }] },
      );

      expect(redis.commands).toEqual([
        ['hset', 'book:book-1:voice-a:durations', { 7: 12.5 }],
        ['hset', 'book:book-1:voice-a:cues', { 7: JSON.stringify([[0, 1.5]]) }],
      ]);
      expect(redis.exec).toHaveBeenCalledTimes(1);
    });

    // HSET writes a single field atomically, which is why the look-ahead's parallel
    // writers need no read-modify-write and no retry loop - see ticket 08's design note.
    test('writes one field per Chunk, never the whole hash', async () => {
      const redis = fakeRedis();

      await createChunkIndexClient({ redis }).writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 12.5, spans: [] },
      );

      const [, , fields] = redis.commands[0];
      expect(Object.keys(fields)).toEqual(['7']);
    });

    // Generation is the source of truth; the index is downstream of it. A cache that
    // refused a write must not cost the Listener the audio that was just synthesized.
    test('swallows a Redis failure so generation still succeeds', async () => {
      const redis = fakeRedis();
      redis.exec.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        createChunkIndexClient({ redis }).writeChunk(
          { ...book, chunkIndex: 7 },
          { durationSeconds: 12.5, spans: [] },
        ),
      ).resolves.toBeUndefined();
    });

    test('does nothing when no credentials were configured', async () => {
      await expect(
        createChunkIndexClient({}).writeChunk(
          { ...book, chunkIndex: 7 },
          { durationSeconds: 12.5, spans: [] },
        ),
      ).resolves.toBeUndefined();
    });

    // A duration the playlist could not use would index a Chunk as playable that isn't,
    // and the index has no way to find out it was wrong - nothing re-reads it.
    test('indexes nothing when the duration could not back a segment', async () => {
      const redis = fakeRedis();

      await createChunkIndexClient({ redis }).writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 0, spans: [] },
      );

      expect(redis.exec).not.toHaveBeenCalled();
    });
  });

  // Nothing removed this before, and nothing else ever could: the Chunk index arrived after
  // deleteBook's cascade was written, and adding a second store to the write path did not
  // put it on the delete path. See ticket 13.
  describe('removeBook', () => {
    test('deletes both hashes for every voice the Book could have been narrated in', async () => {
      const redis = fakeRedis();
      const client = createChunkIndexClient({ redis });

      await client.removeBook({ bookId: 'book-1' }, ['voice-a', 'voice-b']);

      expect(redis.commands).toEqual([
        ['del', 'book:book-1:voice-a:durations'],
        ['del', 'book:book-1:voice-a:cues'],
        ['del', 'book:book-1:voice-b:durations'],
        ['del', 'book:book-1:voice-b:cues'],
      ]);
    });

    // One round trip regardless of how many voices there are, matching writeChunk. Unlike
    // R2, Redis offers no prefix listing to sweep a Book's keys without naming them.
    test('issues them as one pipeline rather than a call per key', async () => {
      const redis = fakeRedis();
      const client = createChunkIndexClient({ redis });

      await client.removeBook({ bookId: 'book-1' }, ['voice-a', 'voice-b']);

      expect(redis.exec).toHaveBeenCalledTimes(1);
    });

    // Deleting is not a read whose miss is harmless, but by the time this runs the Book's
    // objects and index entry are already gone, so failing the whole delete would report a
    // failure for something that mostly succeeded. Same rule as every other write here.
    test('swallows a Redis failure rather than failing a delete that already happened', async () => {
      const redis = fakeRedis();
      redis.exec.mockRejectedValue(new Error('Redis is unreachable'));
      // orMiss warns rather than errors - it is reporting a degraded cache, not a fault.
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = createChunkIndexClient({ redis });

      await expect(client.removeBook({ bookId: 'book-1' }, ['voice-a'])).resolves.not.toThrow();
      expect(consoleWarn).toHaveBeenCalled();
    });

    test('does nothing at all without a Redis client, like every other method here', async () => {
      await expect(
        createChunkIndexClient({ redis: undefined }).removeBook({ bookId: 'book-1' }, ['voice-a']),
      ).resolves.toBeUndefined();
    });
  });
});

describe('createChunkIndexClient, wiring', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test('is disabled when the Vercel KV credentials are absent', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');

    await expect(createChunkIndexClient().readIndex(book)).resolves.toBeUndefined();
  });
});
