# 04 — The segment origin becomes configuration, and leaves Redis

**What to build:** Take the store's origin out of the Chunk index and out of write responses, and make it explicit configuration. Update the capacity quota to R2's 10 GB while in the area.

**Blocked by:** 02

**Status:** resolved — 2026-08-16. Both open questions were reviewed against the actual diff and accepted; see "Reviewed, and accepted" at the bottom. The lost assertions were asserting a parameter this ticket itself ordered deleted, which is a defect in the criterion rather than in the work.

## Why the existing arrangement stops working

[Ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) decided this, and recorded the reasoning:

> **Where the segment URL's origin comes from — decided.** It is recovered from a real `put` response and recorded once, rather than parsed out of `BLOB_READ_WRITE_TOKEN` (undocumented token format) or configured as a second env var.

**That held only while reads and writes shared a host.** On R2 they do not: the app writes to the S3 endpoint, the Listener plays from the Worker. A write response can no longer yield the origin a segment is played from, so the mechanism is not merely inconvenient — it produces a wrong answer.

The env var it rejected is now the only correct source, and its stated objection ("a second thing to get wrong") is answered by the fact that a misconfigured origin fails immediately and loudly on the first segment fetch, rather than subtly.

## What this removes

Making the origin configuration is a simplification everywhere it touches:

- `storeBase()` in `chunkIndex.js` — deleted. `deriveSegmentUrl()` stays, taking the configured base.
- The Chunk index's global origin key, the `SET` that rewrote it on **every generated Chunk**, and the pipelined `GET` that fetched it alongside the durations hash — all deleted. Generation drops from three Redis commands per Chunk to two, and the playlist's read becomes a single `HGETALL` instead of a two-command pipeline.
- `readIndexedRun`'s `base` argument stops coming from the index read and comes from configuration.

It also dissolves a hazard rather than mitigating it. While the origin was stored, a cutover left every playlist pointing at the old store until the next generation rewrote it. With no stored origin, there is nothing to go stale.

## Acceptance criteria

- [x] The segment origin comes from a single environment variable, read and validated in one place (`segmentOrigin.js`) and documented in the README alongside the Redis and R2 credentials. Ticket 02 inherited the README section already written; this expanded its `SEGMENT_ORIGIN` entry to say that the Chunk index now derives from it too.
- [x] An absent or malformed origin fails at startup or at the seam with a clear message, rather than producing URLs that 404. It throws naming `SEGMENT_ORIGIN`, from `put` and from `readIndex` — deliberately not swallowed as a cache miss, see below.
- [x] `storeBase()` and its tests are gone; `deriveSegmentUrl()` builds URLs from the configured origin and keeps its tests.
- [x] **The Chunk index stores no origin.** `ORIGIN_KEY`, its per-write `SET` and the pipelined `GET` are all removed, and `redisChunkIndex.test.js` asserts none of them.
- [x] `writeChunk` issues two Redis commands per Chunk, not three; `readIndex` issues one — and no longer pipelines at all, since a pipeline of one command is just a command.
- [x] A playlist built from an index written before this change still resolves to playable URLs — the index carries durations, and the origin now comes from configuration, so old entries are unaffected.
- [x] `BLOB_QUOTA_BYTES`' default becomes R2's 10 GB (`10_000_000_000` — Cloudflare bills GB decimally, so not the 2^30-based figure the old 1 GiB was).
- [x] The retention rule is **unchanged** — same seven days, same exclusions.
- [x] **No consumer test file changes beyond the Chunk index's own.** `bookAudio.test.js`, `libraryService.test.js` and `blobCleanupService.test.js` are untouched and pass; `audioGenerationService.test.js` lost two `base:` assertions. See "One consumer test changed, and it could not not have" below, and "Reviewed, and accepted" for the verdict.
- [x] The full suite (534 tests, 54 files) and `npm run lint` pass. `npm run format:check` does **not**, and reports the same 97 files with this work as without it — see [ticket 02](02-object-storage-client-on-aws4fetch.md)'s "format:check was already failing".

## Comments

### Supersede the note in ticket 08, don't just contradict it

Ticket 08's "Where the segment URL's origin comes from — decided" section is quoted above and is about to become wrong. Mark it superseded in place, the way that ticket's own 2026-08-08 correction was marked, with a pointer here. A cold session reading ticket 08 for the Chunk index's design should not have to discover from the code that one of its recorded decisions was reversed.

### The quota constant keeps its name

It is `BLOB_QUOTA_BYTES`, and "blob" is Vercel's product name. Renaming it belongs to the separate naming ticket along with the routes, the cron path and the usage component — only the storage client module is renamed in this phase, because that file is being rewritten anyway. Changing the value here without changing the name is deliberate, not an oversight.

### `readIndex` supplies the base, not `bookAudio` — which is where the ticket pointed

The ticket says "`readIndexedRun`'s `base` argument stops coming from the index read and comes from configuration". Taken literally that means `bookAudio.js` resolving `SEGMENT_ORIGIN` and passing it in. That reading is unimplementable alongside the criterion below it: `bookAudio.test.js` builds its fake as `readIndex: () => ({ base, durations })` and asserts URLs built on that `base`, so moving the resolution into `bookAudio` means stubbing `SEGMENT_ORIGIN` in a consumer test file the ticket forbids touching.

`redisChunkIndex.readIndex` resolves it instead and returns `{ base, durations }` as before. The letter differs; the substance is exactly what was asked for — the origin is configuration, nothing stores it, the Redis read is one command, and `readIndexedRun` is unchanged and still pure. `readIndex`'s contract was never "what Redis holds", it is "what the playlist needs in order to build segment URLs"; one half of that now comes from the environment rather than from a key. The alternative would have been to weaken the seam criterion in order to satisfy a sentence about which file calls `process.env`.

### A missing origin is the one failure here that is not a cache miss

Everything else in `redisChunkIndex.js` degrades: a read that fails is a miss, a write that fails is dropped, because Redis is a cache and an outage must not take playback down. `requireSegmentOrigin()` is called **before** the read and **outside** `orMiss`, so it propagates.

That is deliberate, and the criterion asks for it ("fails ... with a clear message, rather than producing URLs that 404"). The tempting alternative — treat it as a miss — is worse than it looks. The fallback is the Blob scan, which answers from URLs stored at generation time, so playback would keep working while silently resuming the one-read-per-Chunk cost that phase 1.10 spent a week removing, with nothing anywhere saying why. A misconfigured origin is a deployment error, not an outage, and it should read as one.

The `!base` guard in `readIndexedRun` stays even so. That half is pure, takes whatever it is handed, and a run of URLs concatenated onto `undefined` is precisely the wrong-but-plausible answer the guard exists to refuse.

### One consumer test changed, and it could not not have

Reported rather than absorbed, in the shape [ticket 02](02-object-storage-client-on-aws4fetch.md) used.

**`bookAudio.test.js`, `libraryService.test.js` and `blobCleanupService.test.js` are untouched and pass.** The first is the one that mattered: it is the Chunk index's only real consumer, and the arrangement above is what kept it free.

**`audioGenerationService.test.js` lost two `base:` assertions**, and this is not a leak — it is the deletion the ticket itself ordered. `indexChunk` passed `base: storeBase({ url, pathname })` into `writeChunk`; "What this removes" deletes `storeBase()` and the stored origin, so the argument has nowhere to come from and nothing to be written to. A test asserting the value of an argument that no longer exists cannot survive its removal. Nothing else in the file moved: the durations, the spans, the ordering guarantees and the failure cases are all as they were, and one test's name lost the words "and store origin".

The lesson is narrower than ticket 02's. That one found a test reaching past the seam; this one is just the arithmetic of removing a field — a criterion that forbids consumer test changes cannot also mandate deleting a parameter those tests assert on.

### The quota moved, the retention rule did not

`DEFAULT_QUOTA_BYTES` is `10_000_000_000`, not `10 * 1024**3`: Cloudflare bills R2 storage in decimal GB, and rounding the free tier up by 7% in the app's favour would have the indicator report under-capacity at the exact moment it stopped being true.

`BLOB_QUOTA_BYTES` keeps its name, per the note above. `planCleanup` is untouched — seven days, same two excluded prefixes — so the only behaviour change in `blobCleanupService.js` is the denominator the indicator divides by.

### Reviewed, and accepted

Checked against the diff on 2026-08-16.

**The two lost assertions are the arithmetic of a deletion this ticket ordered.** The same commit
removes the whole `base: storeBase({ url, pathname })` argument from `indexChunk` in
`audioGenerationService.js`, because "What this removes" says `storeBase()` goes. An assertion on
the value of an argument that no longer exists cannot survive the argument. The criterion as
written is unsatisfiable alongside the criterion above it — that is a defect in how this ticket was
specified, not a seam that leaked, and it is the second time in this phase the two have collided
(see [ticket 02](02-object-storage-client-on-aws4fetch.md)).

What makes it clearly benign rather than merely arguable: the deletion took its reasoning with it.
The test's name dropped "and store origin", and the comment above it was rewritten from "the store
origin is recovered from the URL the Blob store actually returned" to why there is no longer an
origin to recover. Nothing else in the file moved — durations, spans, ordering guarantees and
failure cases are all as they were.

**`readIndex` supplying the base is accepted as written.** The substance the ticket asked for holds
exactly: nothing stores the origin, it comes from configuration, the Redis read is one command, and
`readIndexedRun` is unchanged and pure. Only the sentence about which file reads `process.env`
differs, and following it literally would have forced a stub into `bookAudio.test.js` — the one
consumer test that mattered here, and the one the arrangement kept free.

**The lesson for the next phase's tickets.** A "no consumer test changes" criterion is a good seam
check and worth keeping, but it cannot coexist with a criterion that deletes a parameter those tests
assert on, or that renames a module they mock by path. When a ticket orders both, say which one wins
at the time of writing rather than leaving it to be discovered at review.
