import { describe, expect, test, vi } from 'vitest';

import { createResumePositionClient } from './redisResumePosition';

const BOOK = 'book-1';

// A stand-in for the Upstash client. `eval` is recorded rather than interpreted - what
// matters here is which script, keys and arguments were sent, and the Lua itself is the
// one thing a fake can't check (see the ticket's note about verifying it live).
function fakeRedis({ evalResult = 1, hmget, hgetall } = {}) {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
    hmget: vi.fn().mockResolvedValue(hmget),
    hgetall: vi.fn().mockResolvedValue(hgetall),
    hdel: vi.fn().mockResolvedValue(3),
  };
}

describe('createResumePositionClient', () => {
  describe('write', () => {
    const position = { resumeIndex: 7, resumeSentenceIndex: 2, updatedAt: 1_000 };

    test('sends the position and its updatedAt to one atomic script', async () => {
      const redis = fakeRedis();

      await createResumePositionClient({ redis }).write(BOOK, position);

      expect(redis.eval).toHaveBeenCalledTimes(1);
      const [script, keys, args] = redis.eval.mock.calls[0];
      expect(script).toContain('HSET');
      expect(keys).toEqual(['library:resume']);
      expect(args).toEqual(['book-1:chunk', 'book-1:sentence', 'book-1:at', 7, 2, 1_000]);
    });

    // The script indexes ARGV by position: ARGV[3] is the `at` field name and ARGV[6] its
    // value, which only holds while the argument list is three names then three values in
    // the same order. Adding a fourth field without renumbering the Lua would silently
    // compare the wrong one, so the two are pinned here together.
    test('lines the script up with the argument order it indexes by', async () => {
      const redis = fakeRedis();

      await createResumePositionClient({ redis }).write(BOOK, position);

      const [script, , args] = redis.eval.mock.calls[0];
      expect(script).toContain("HGET', KEYS[1], ARGV[3]");
      expect(script).toContain('tonumber(ARGV[6])');
      expect(args[2]).toBe('book-1:at');
      expect(args[5]).toBe(position.updatedAt);
    });

    // The whole reason this is a script rather than an HSET: the comparison and the write
    // have to be one step. A read followed by a conditional write would let two devices
    // both read "older" and both decide they win.
    test('compares and writes in a single round trip, never read-then-write', async () => {
      const redis = fakeRedis();

      await createResumePositionClient({ redis }).write(BOOK, position);

      expect(redis.hmget).not.toHaveBeenCalled();
      expect(redis.hgetall).not.toHaveBeenCalled();
    });

    test('reports whether the write won or was rejected as stale', async () => {
      const wrote = await createResumePositionClient({
        redis: fakeRedis({ evalResult: 1 }),
      }).write(BOOK, position);
      const rejected = await createResumePositionClient({
        redis: fakeRedis({ evalResult: 0 }),
      }).write(BOOK, position);

      expect(wrote).toBe(true);
      expect(rejected).toBe(false);
    });

    // Losing a position save must never surface to the Listener - playback carries on and
    // the next Sentence tries again.
    test('is undefined rather than an error when Redis fails', async () => {
      const redis = fakeRedis();
      redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        createResumePositionClient({ redis }).write(BOOK, position),
      ).resolves.toBeUndefined();
    });

    test('does nothing when no credentials were configured', async () => {
      await expect(
        createResumePositionClient({ redis: null }).write(BOOK, position),
      ).resolves.toBeUndefined();
    });

    // A position with no timestamp can't be compared against anything, and writing it
    // would let it win forever - nothing later could prove it was older.
    test('refuses a position carrying no usable updatedAt', async () => {
      const redis = fakeRedis();
      const client = createResumePositionClient({ redis });

      await client.write(BOOK, { resumeIndex: 7, resumeSentenceIndex: 2 });
      await client.write(BOOK, { resumeIndex: 7, resumeSentenceIndex: 2, updatedAt: 'soon' });

      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  describe('read', () => {
    // HMGET resolves to an object keyed by field name, not an array in request order -
    // the same client behaviour ticket 08 was caught by.
    test('returns the stored position for one Book', async () => {
      const redis = fakeRedis({
        hmget: { 'book-1:chunk': 7, 'book-1:sentence': 2, 'book-1:at': 1_000 },
      });

      const position = await createResumePositionClient({ redis }).read(BOOK);

      expect(redis.hmget).toHaveBeenCalledWith(
        'library:resume',
        'book-1:chunk',
        'book-1:sentence',
        'book-1:at',
      );
      expect(position).toEqual({ resumeIndex: 7, resumeSentenceIndex: 2, updatedAt: 1_000 });
    });

    test('coerces values the client handed back as strings', async () => {
      const redis = fakeRedis({
        hmget: { 'book-1:chunk': '7', 'book-1:sentence': '2', 'book-1:at': '1000' },
      });

      const position = await createResumePositionClient({ redis }).read(BOOK);

      expect(position).toEqual({ resumeIndex: 7, resumeSentenceIndex: 2, updatedAt: 1_000 });
    });

    // Distinct from a position of zero, which is a real place in the Book: undefined means
    // "ask the Blob snapshot", and zero means "the Listener is at the start".
    test('is undefined when the Book has no stored position', async () => {
      await expect(
        createResumePositionClient({ redis: fakeRedis({ hmget: null }) }).read(BOOK),
      ).resolves.toBeUndefined();
    });

    test('is undefined when Redis fails or is not configured', async () => {
      const redis = fakeRedis();
      redis.hmget.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createResumePositionClient({ redis }).read(BOOK)).resolves.toBeUndefined();
      await expect(createResumePositionClient({ redis: null }).read(BOOK)).resolves.toBeUndefined();
    });
  });

  describe('readAll', () => {
    // The Library list needs every Book's position at once. One HGETALL rather than one
    // read per Book, which is the shape of bug this whole run of tickets is about.
    test('returns a position per Book from one call', async () => {
      const redis = fakeRedis({
        hgetall: {
          'book-1:chunk': 7,
          'book-1:sentence': 2,
          'book-1:at': 1_000,
          'book-2:chunk': 0,
          'book-2:sentence': 5,
          'book-2:at': 2_000,
        },
      });

      const positions = await createResumePositionClient({ redis }).readAll();

      expect(redis.hgetall).toHaveBeenCalledWith('library:resume');
      expect(positions).toEqual({
        'book-1': { resumeIndex: 7, resumeSentenceIndex: 2, updatedAt: 1_000 },
        'book-2': { resumeIndex: 0, resumeSentenceIndex: 5, updatedAt: 2_000 },
      });
    });

    // A half-written Book can't be placed, and reporting it with a missing field as zero
    // would silently send the Listener back to the start of the Book.
    test('omits a Book whose fields are not all present', async () => {
      const redis = fakeRedis({ hgetall: { 'book-1:chunk': 7, 'book-1:at': 1_000 } });

      await expect(createResumePositionClient({ redis }).readAll()).resolves.toEqual({});
    });

    test('is undefined when Redis fails, so callers fall back per Book', async () => {
      const redis = fakeRedis();
      redis.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createResumePositionClient({ redis }).readAll()).resolves.toBeUndefined();
    });

    test('is an empty set, not a failure, when nothing has ever been stored', async () => {
      await expect(
        createResumePositionClient({ redis: fakeRedis({ hgetall: null }) }).readAll(),
      ).resolves.toEqual({});
    });
  });

  describe('remove', () => {
    test('drops all three fields for the Book', async () => {
      const redis = fakeRedis();

      await createResumePositionClient({ redis }).remove(BOOK);

      expect(redis.hdel).toHaveBeenCalledWith(
        'library:resume',
        'book-1:chunk',
        'book-1:sentence',
        'book-1:at',
      );
    });

    // Deleting a Book must succeed even if its position can't be cleared; the leftover
    // fields are unreachable once the Book is out of the index.
    test('swallows a failure so the delete cascade still completes', async () => {
      const redis = fakeRedis();
      redis.hdel.mockRejectedValue(new Error('ECONNREFUSED'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(createResumePositionClient({ redis }).remove(BOOK)).resolves.toBeUndefined();
    });
  });
});
