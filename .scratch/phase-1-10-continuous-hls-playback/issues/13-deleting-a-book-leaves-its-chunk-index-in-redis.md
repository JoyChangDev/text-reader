# 13 — Deleting a Book leaves its Chunk index in Redis forever

**What to build:** Make `deleteBook`'s cascade reach the Redis Chunk index. It removes the Book from the Library index, its blobs, its audio and its resume position, and leaves `book:<bookId>:<voice>:durations` and `:cues` behind with nothing left that could ever refer to them.

**Blocked by:** —

**Status:** resolved — 2026-08-11. `removeBook` joins the cascade, verified against the live Upstash and R2 on a throwaway Book. **One thing is left over rather than fixed:** the orphan this was found by, `book:84ee9c96…:{durations,cues}`, is still in Redis — the fix stops new ones and does not retroactively collect old ones. Two `DEL`s clear it whenever someone wants to.

Found by running phase 1.11 [ticket 05](../../phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md)'s
deletion criterion on 2026-08-11 — the R2 half of which passed cleanly, which is what left the
Redis half visible.

## Measured

Deleting the 42-Chunk Book `84ee9c96…` from the Library, then reading both stores:

|                                 | before     | after                   |
| ------------------------------- | ---------- | ----------------------- |
| `84ee9c96…/` in R2              | 84 objects | **0**                   |
| `library/84ee9c96…/chunks.json` | present    | **gone**                |
| `library/index.json`            | 17,001 B   | **10,073 B**, rewritten |
| `library:resume`                | 2 Books    | **1 Book**              |
| `book:84ee9c96…:durations`      | 42 fields  | **42 fields**           |
| `book:84ee9c96…:cues`           | 42 fields  | **42 fields**           |

The two orphaned hashes hold **3,642 bytes over 42 Chunks — about 87 bytes per Chunk**, cues
being the larger of the pair.

## Why it happens

[`deleteBook`](../../../app/_lib/libraryService.js) removes the index entry, the chunks and
resume blobs, the stored position via `positionClient`, and every audio object under the
Book's prefix. It never touches the Chunk index — and it could not, because
[`redisChunkIndex.js`](../../../app/_lib/redisChunkIndex.js) **has no delete operation at
all.** The client exposes reads and the generation-time write, and nothing else.

Its own comment describes the cascade as covering "every audio/metadata blob
`audioGenerationService.js` cached", which was true when written: the Chunk index arrived later,
in ticket 08's stage 2, and adding a second store to the write path did not put it on the
delete path.

`scripts/clear-abandoned-library.mjs` does sweep `book:*` — so the keys are reachable in
principle — but that is a one-time cutover script, not something the app runs.

## What it costs

87 bytes per Chunk of a deleted Book, permanently, against Upstash's 256 MB. One Book of this
size is 3.6 KB and nothing to worry about on its own. What makes it worth fixing is that it is
**unbounded in the one direction nobody watches**: it grows with deletions rather than with
Books held, so a Listener who uploads, listens and deletes — the normal cycle for a Book you
have finished — accumulates it forever while the Library looks empty. At the phase's ~2,000-Chunk
target it is ~170 KB per deleted Book.

There is no cleanup path that would ever collect it. `blobCleanupService` is object storage only.

## Acceptance criteria

- [x] Deleting a Book removes its Chunk index for every voice it was narrated in, not only the voice most recently used — the key is per (Book, voice) and a Book read in two voices has two of each hash. _`removeBook` deletes both hashes for every voice in `AVAILABLE_VOICES`, in one pipeline. A `DEL` against a key that was never written costs nothing, so naming all three unconditionally is cheaper than recording which were used._
- [x] The removal is covered at the same seam the rest of the cascade is, with the injected client, so the test does not reach Upstash. _`chunkIndexClient` joins `storageClient` and `positionClient` in `defaultClients`; `libraryService.test.js` asserts against a fake._
- [x] A delete whose Redis half fails does not leave the Book half-deleted in a worse way than it already would — decide and state whether Redis failing should fail the delete, given the R2 half is already gone by then. _**Decided: swallow it**, via the same `orMiss` every other write here uses. By the time this runs the Book's objects and index entry are gone, so throwing would report a failed delete for one that substantially happened and leave the caller nothing to do. There is a test for it, and the reasoning is in the code rather than only here._
- [x] Verified against the real store the way this was found: delete a Book, then `SCAN book:*` and confirm nothing of it remains. _2026-08-11, through the local dev server against the live R2 and Upstash, on a throwaway Book so nothing real was risked: **before** 2 Redis keys and 2 R2 objects, **after** 0 and 0, with the other Books' four keys untouched._

## Comments

### The voice fan-out is the part that is easy to get wrong

Audio is stored per (Book, voice) and so is the index, but `deleteBook` finds audio by listing
the Book's R2 prefix, which sweeps up every voice without needing to know which ones exist.
Redis has no such listing at hand, and `SCAN` per delete is the sort of thing that looks fine
with one Listener and stops looking fine later. The Library index entry does not record which
voices a Book was narrated in; something has to, or the pattern has to be matched.

Worth checking whether `AVAILABLE_VOICES` is a small enough fixed set to just delete every
possible key unconditionally — a handful of `DEL`s against a Book that may only have one is
still one round trip, and it needs no new state.
