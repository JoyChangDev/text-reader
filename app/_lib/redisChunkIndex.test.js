import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createChunkIndexClient } from './redisChunkIndex';

const book = { bookId: 'book-1', voice: 'voice-a' };

// A stand-in for @upstash/redis's pipeline: records the commands queued against it and
// resolves exec() with whatever the test wants them to have returned, in order.
function fakeRedis(results = []) {
  const commands = [];
  const pipeline = {
    hgetall: (...args) => (commands.push(['hgetall', ...args]), pipeline),
    hmget: (...args) => (commands.push(['hmget', ...args]), pipeline),
    hset: (...args) => (commands.push(['hset', ...args]), pipeline),
    get: (...args) => (commands.push(['get', ...args]), pipeline),
    set: (...args) => (commands.push(['set', ...args]), pipeline),
    exec: vi.fn(async () => results),
  };

  return { commands, pipeline: () => pipeline, exec: pipeline.exec };
}

describe('createChunkIndexClient', () => {
  describe('readIndex', () => {
    test('reads the durations hash and the recorded origin in one pipeline', async () => {
      const redis = fakeRedis([{ 0: '12.5', 1: '11' }, 'https://abc.blob.example/']);
      const client = createChunkIndexClient({ redis });

      const index = await client.readIndex(book);

      expect(redis.commands).toEqual([
        ['hgetall', 'book:book-1:voice-a:durations'],
        ['get', 'blob:origin'],
      ]);
      expect(redis.exec).toHaveBeenCalledTimes(1);
      expect(index).toEqual({
        base: 'https://abc.blob.example/',
        durations: { 0: '12.5', 1: '11' },
      });
    });

    // The index is a cache, so an unreachable or misbehaving Redis has to look exactly
    // like an index that was never written: a miss, which sends the caller to Blob.
    // Anything else would let a Redis outage take playback down with it.
    test('is a miss rather than an error when Redis fails', async () => {
      const redis = fakeRedis();
      redis.exec.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createChunkIndexClient({ redis }).readIndex(book)).resolves.toBeUndefined();
    });

    test('is a miss when no credentials were configured, so a fresh clone still plays', async () => {
      await expect(createChunkIndexClient({}).readIndex(book)).resolves.toBeUndefined();
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
    test('writes the duration, the cues and the origin in one pipeline', async () => {
      const redis = fakeRedis();
      const client = createChunkIndexClient({ redis });

      await client.writeChunk(
        { ...book, chunkIndex: 7 },
        {
          durationSeconds: 12.5,
          spans: [{ startSeconds: 0, endSeconds: 1.5 }],
          base: 'https://abc.blob.example/',
        },
      );

      expect(redis.commands).toEqual([
        ['hset', 'book:book-1:voice-a:durations', { 7: 12.5 }],
        ['hset', 'book:book-1:voice-a:cues', { 7: JSON.stringify([[0, 1.5]]) }],
        ['set', 'blob:origin', 'https://abc.blob.example/'],
      ]);
      expect(redis.exec).toHaveBeenCalledTimes(1);
    });

    // HSET writes a single field atomically, which is why the look-ahead's parallel
    // writers need no read-modify-write and no retry loop - see ticket 08's design note.
    test('writes one field per Chunk, never the whole hash', async () => {
      const redis = fakeRedis();

      await createChunkIndexClient({ redis }).writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 12.5, spans: [], base: 'https://abc.blob.example/' },
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
          { durationSeconds: 12.5, spans: [], base: 'https://abc.blob.example/' },
        ),
      ).resolves.toBeUndefined();
    });

    test('does nothing when no credentials were configured', async () => {
      await expect(
        createChunkIndexClient({}).writeChunk(
          { ...book, chunkIndex: 7 },
          { durationSeconds: 12.5, spans: [], base: 'https://abc.blob.example/' },
        ),
      ).resolves.toBeUndefined();
    });

    // A duration the playlist could not use would index a Chunk as playable that isn't,
    // and the index has no way to find out it was wrong - nothing re-reads it.
    test('indexes nothing when the duration could not back a segment', async () => {
      const redis = fakeRedis();

      await createChunkIndexClient({ redis }).writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 0, spans: [], base: 'https://abc.blob.example/' },
      );

      expect(redis.exec).not.toHaveBeenCalled();
    });

    test('indexes nothing when the store origin is not known', async () => {
      const redis = fakeRedis();

      await createChunkIndexClient({ redis }).writeChunk(
        { ...book, chunkIndex: 7 },
        { durationSeconds: 12.5, spans: [], base: undefined },
      );

      expect(redis.exec).not.toHaveBeenCalled();
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
