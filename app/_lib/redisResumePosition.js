import { orMiss, redisFromEnv } from './upstashRedis';

// Where the Listener's place in each Book lives - see
// .scratch/phase-1-10-continuous-hls-playback/issues/10-resume-position-spends-an-advanced-operation-per-sentence.md.
//
// It used to be a field inside the `library/index` blob, rewritten in full every time the
// active Sentence changed. That spent an Advanced Operation per Sentence against a 2,000
// monthly allowance, and it was a read-modify-write of a document `addBook` also rewrites,
// so the two could lose each other silently. Both problems came from one cause: a counter
// that moves every few seconds living inside a document that otherwise only changes when a
// Book is added or removed.
//
// Unlike the Chunk index, Redis is the *source of truth* here - a resume position has no
// second copy to rebuild from. libraryService keeps a Blob snapshot at the flush points so
// an unavailable Redis costs at most the last session rather than everything.

const RESUME_KEY = 'library:resume';

// Three plain numeric fields per Book rather than one JSON value, so the script below
// needs no cjson and cannot be broken by a malformed stored value. bookId is a
// crypto.randomUUID() (see BookUploader.jsx), which never contains a colon, so the prefix
// is unambiguous to split back apart in readAll.
const FIELDS = ['chunk', 'sentence', 'at'];
const fieldsFor = (bookId) => FIELDS.map((field) => `${bookId}:${field}`);

// The write has to compare and store in one step. A read followed by a conditional write
// would let two devices both read an older timestamp and both conclude they win, which is
// the exact race this ticket exists to close - and Upstash's REST API has no WATCH to
// build the conditional write out of, so a script is the only atomic option.
//
// `>=` rather than `>` on the reject side: an identical timestamp is the same save arriving
// twice, and keeping the stored copy makes a retry harmless.
//
// ARGV is `[...fieldsFor(bookId), chunk, sentence, at]` - the three field NAMES followed by
// their three VALUES, in FIELDS order. So ARGV[n] and ARGV[n+3] are always a name/value
// pair, and ARGV[3]/ARGV[6] is the `at` pair the comparison turns on. Adding a fourth entry
// to FIELDS without re-numbering this script would silently compare the wrong field, so the
// two are asserted together in redisResumePosition.test.js.
const WRITE_IF_NEWER = `
local storedAt = redis.call('HGET', KEYS[1], ARGV[3])
if storedAt and tonumber(storedAt) and tonumber(storedAt) >= tonumber(ARGV[6]) then
  return 0
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[4], ARGV[2], ARGV[5], ARGV[3], ARGV[6])
return 1
`;

// Values come back as numbers on some paths and strings on others (see ticket 08's note on
// the client's deserializers), so every read coerces. A field that isn't a finite number is
// treated as absent, which makes a half-written Book a miss rather than a position of zero -
// zero is a real place in a Book and would send the Listener back to the start.
function toPosition(chunk, sentence, at) {
  const resumeIndex = Number(chunk);
  const resumeSentenceIndex = Number(sentence);
  const updatedAt = Number(at);
  const usable =
    chunk != null &&
    sentence != null &&
    at != null &&
    Number.isFinite(resumeIndex) &&
    Number.isFinite(resumeSentenceIndex) &&
    Number.isFinite(updatedAt);

  return usable ? { resumeIndex, resumeSentenceIndex, updatedAt } : undefined;
}

export function createResumePositionClient({ redis = redisFromEnv() } = {}) {
  return {
    // true if this save won, false if a newer one was already stored, undefined if Redis
    // could not be reached. All three are survivable: the Listener keeps playing and the
    // next Sentence tries again.
    async write(bookId, { resumeIndex, resumeSentenceIndex, updatedAt }) {
      if (!redis) return undefined;
      // A position with no usable timestamp can never be shown to be older than anything,
      // so storing it would let it win against every later save forever. The route rejects
      // this with a 400; repeating it here keeps the rule true for any other caller.
      // Number.isFinite does not coerce, so a string is already rejected.
      if (!Number.isFinite(updatedAt)) return undefined;

      const written = await orMiss('the resume position could not be stored', () =>
        redis.eval(
          WRITE_IF_NEWER,
          [RESUME_KEY],
          [
            ...fieldsFor(bookId),
            Number(resumeIndex),
            Number(resumeSentenceIndex),
            Number(updatedAt),
          ],
        ),
      );

      return written === undefined ? undefined : written === 1;
    },

    async read(bookId) {
      if (!redis) return undefined;

      return orMiss('the resume position could not be read', async () => {
        const fields = fieldsFor(bookId);
        // Keyed by field name rather than by position - see ticket 08.
        const values = await redis.hmget(RESUME_KEY, ...fields);
        return toPosition(...fields.map((field) => values?.[field]));
      });
    },

    // Every Book's position in one call, for the Library list. One read per Book is the
    // shape of bug tickets 08 through 10 are all about.
    async readAll() {
      if (!redis) return undefined;

      return orMiss('the resume positions could not be listed', async () => {
        const values = (await redis.hgetall(RESUME_KEY)) ?? {};
        // Split at the last colon rather than by a fixed suffix length - the three
        // suffixes differ in length, and a uuid bookId never contains one.
        const bookIds = new Set(
          Object.keys(values).map((field) => field.slice(0, field.lastIndexOf(':'))),
        );

        return [...bookIds].reduce((positions, bookId) => {
          const position = toPosition(...fieldsFor(bookId).map((field) => values[field]));
          return position ? { ...positions, [bookId]: position } : positions;
        }, {});
      });
    },

    async remove(bookId) {
      if (!redis) return undefined;

      await orMiss('the resume position could not be dropped', () =>
        redis.hdel(RESUME_KEY, ...fieldsFor(bookId)),
      );
    },
  };
}
