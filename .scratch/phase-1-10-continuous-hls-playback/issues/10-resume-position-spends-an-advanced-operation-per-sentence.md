# 10 — The resume position spends an Advanced Operation per Sentence

**What to build:** Move the reading position out of the `library/index` blob and into Redis, written per Book as a single atomic field that carries its own `updatedAt`.

**Blocked by:** —

**Status:** ready-for-human — built 2026-08-09, see the notes at the bottom. The Lua script has never run against the real service.

Found on 2026-08-09 while checking Vercel Blob's operation classes for ticket 08's stage 2. Third instance of the same bug shape as [ticket 08](08-playlist-routes-read-one-blob-per-chunk.md) and [ticket 09](09-blob-usage-indicator-costs-an-advanced-operation.md) — a storage call on a hot path whose cost nobody was counting — but this one is on the **write** side, and it spends the smaller of the two quotas.

## What happens

[useBookPlayer.js:352](../../../app/_lib/useBookPlayer.js#L352) persists the reading position whenever the active Sentence changes. `RESUME_PERSIST_DEBOUNCE_MS` is 400ms, which only coalesces React's own re-renders — it does not throttle across Sentences, and the comment directly above it says as much: "natural playback advances the active Sentence roughly every few seconds".

Each save reaches [libraryService.js:59](../../../app/_lib/libraryService.js#L59)'s `updateResumeIndex`, which is a read-modify-write of the whole Library index:

```js
const index = await readIndex(storageClient); // get()     → 1 Simple Operation
// ...rebuild the entire array with one field changed...
await storageClient.putJson(INDEX_KEY, updatedIndex); // put()     → 1 Advanced Operation
```

**`put()` is an Advanced Operation**, and Hobby includes **2,000 a month** — the same allowance ticket 09 found sitting at 1.9k/2k. `chunkText` caps a Chunk at 200 chars / 4 Sentences, so a Sentence is on the order of ten seconds of narration:

|                                                 |                           |
| ----------------------------------------------- | ------------------------- |
| Advanced Operations per hour of listening       | ~330                      |
| Hobby monthly allowance                         | 2,000                     |
| **Listening before the allowance is exhausted** | **under 6 hours a month** |

Stage 2 of ticket 08 does not help here at all: it removed **reads** from the polled path, and those are Simple Operations against a 10k allowance. This is a **write**, against an allowance five times smaller.

## Two problems, one cause

`library/index` holds two kinds of data with completely different lifetimes. `title`, `totalChunks` and `sentenceCountsByChunk` change only when a Book is added or deleted. `resumeIndex` / `resumeSentenceIndex` move every few seconds. **A per-Sentence counter living inside an otherwise-static document** is what produces both of the following, and splitting them is the fix — Redis is just where the hot half belongs.

**The quota burn**, above.

**A lost update that already happens today.** `updateResumeIndex` rewrites the whole index array, and so do [`addBook`](../../../app/_lib/libraryService.js#L24) and [`deleteBook`](../../../app/_lib/libraryService.js#L80). Upload a Book while another one is playing and the two read-modify-writes interleave: one of them is silently lost. Nobody has reported it because the window is small and the symptom — a Book that vanishes from the list, or a reading position that jumps back — looks like something else.

## Design — decided

**The position goes in Redis, one field per Book.** `HSET` writes a single field atomically, so there is no read before the write and no retry loop. Same move as ticket 08's Chunk index, and the same reason: Blob has no compare-and-swap, so any shared document under concurrent writers loses updates undetectably.

Storing the whole index under one Redis key and using `GET` → mutate → `SET` would reproduce the lost update byte for byte. The problem was never _where_ the data lived; it was the read-modify-write of one shared document. **The unit of write has to become the unit of contention.**

**The record carries `updatedAt`, and a write only wins if it is newer.** `updatedAt` is when the position changed **on the client**, not when the request reached the server. Upstash's REST API supports `EVAL` and `/multi-exec` (it does **not** support `WATCH`), so "compare `updatedAt`, write only if newer" is one atomic command.

Rejected alternatives:

- **Take the maximum Sentence ordinal instead of a timestamp** — tempting, because `sentenceOrdinals.js` already gives a Book-global total order and it needs no new field. Rejected: a Listener who deliberately seeks _backwards_ to re-hear something would have that seek refused, permanently, because the stored ordinal is higher. A timestamp is correct in both directions.
- **Throttle the write to every N seconds instead of every Sentence** — rejected as a fix on its own: Sentences already advance about every ten seconds, so even a generous throttle buys well under 2×, against a shortfall of roughly 50×. Worth doing as tidying, not as the answer.
- **Keep it in Blob and write only at the flush points** — rejected: it fixes the quota and leaves the lost update exactly where it is, and it makes the position up to a whole session stale on a crash.
- **Drop the server-side position and go back to `localStorage`** — rejected: cross-device resume is a shipped feature (`.scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md`), and Phase 2 makes it more important, not less.

**Redis is the source of truth for the position; Blob keeps a snapshot.** This deliberately differs from the Chunk index, where Blob stayed authoritative and Redis was a pure cache. There is no second copy of a reading position to rebuild from, so something has to hold it — but a snapshot written at the existing flush points ([`flushOnHiddenRef`](../../../app/_lib/useBookPlayer.js#L400), added by phase 1.8 ticket 03) costs a handful of Advanced Operations per session instead of hundreds per hour, and bounds the worst case to "you lose at most the last session" rather than "you lose everything if the Redis database does".

## Acceptance criteria

- [x] Saving the resume position during playback costs **zero** Blob operations of any class. _`updateResumeIndex` without `snapshot` touches only `positionClient.write`, and the route no longer reads the index to prove the Book exists._
- [x] The position is written as a single atomic field per Book — no read of the index before writing, and no retry loop. _`WRITE_IF_NEWER`, one `EVAL`._
- [x] A position save and a concurrent `addBook` or `deleteBook` cannot lose each other's write. _The position path never reads or writes `library/index`, and the snapshot has its own per-Book blob._
- [x] **Every stored position carries an `updatedAt` recording when the position changed on the client**, not when the request reached the server. _Stamped in `persistResumePosition`; the route 400s without it._
- [x] **A write whose `updatedAt` is older than the stored one is rejected, and that comparison is atomic** — not a read followed by a conditional write. _Upstash has no `WATCH`, so the compare lives inside the Lua script. When Redis returns no verdict at all, the snapshot compares for itself before overwriting._
- [x] **A deliberate backward seek still persists.** The rule is "newer `updatedAt` wins", never "higher Sentence ordinal wins".
- [x] `listBooks` and `getBook` return the shape they return today, so `BookLibrary.jsx`, `page.jsx` and `useBookPlayer.js`'s persistence effect need no change. _`withPosition` re-adds both fields; no consumer changed._
- [x] A Book with no position in Redis falls back to the Blob snapshot rather than resuming at zero. _In `getBook`, the read that decides where playback resumes._
- [x] An unavailable Redis degrades to the Blob snapshot rather than losing the Listener's place, and a failed save never surfaces as a playback error. _`listBooks` reads the snapshots too, but only when Redis cannot answer at all — a Book added after this ticket has no position on its summary, so without that its progress would read 0% for the whole outage._
- [x] The Blob snapshot is written only at the existing flush points, never per Sentence. _Only `flushOnHiddenRef` passes `snapshot: true`._

## Comments

### Why `updatedAt` is an acceptance criterion here rather than a Phase 2 concern

Phase 2 is Capacitor packaging with offline whole-Book downloads and native background playback (`specs/phase-1-5-audiobook-reader.md:56`). Both mean the same thing for this ticket: **the position will be produced while the device has no network, and reconciled later.** Today's `persistResumePosition` is fire-and-forget — [it catches and logs](../../../app/_lib/useBookPlayer.js#L334), there is no queue and no retry — which is survivable now and is not survivable once a Listener can finish a Book offline.

The failure that follows is the classic one:

> Device A listens offline for an hour, reaching Sentence 800. Device B, online, reaches Sentence 300. A regains network and flushes. **A wins, purely because it arrived last**, and B's newer position is overwritten by hour-old data.

`HSET` does not prevent this; atomicity says nothing about which value is _right_. Only a timestamp carried with the record does. Adding it now costs one field. Adding it in Phase 2 costs a data migration plus a compatibility path for every record written before it existed — which is why it is a criterion here rather than a note for later.

None of this is visible to Capacitor: `bookLibrary.js` is already a thin wrapper over the routes (`specs/phase-1-6-listening-polish.md:64`), so all of it happens behind `PATCH /api/library/[bookId]`.

### What this ticket does not fix

The same Book open on two devices, both online, is still last-write-wins — just by `updatedAt` rather than by arrival order, which makes it a rule instead of an accident. Genuine concurrent reconciliation (merging two positions, prompting the Listener) is out of scope, and for a reading position it probably always should be.

### Not measured

The ~330/hour figure is derived from `chunkText`'s 200-char / 4-Sentence cap, not observed. The store has been over its Blob quota since 2026-08-08 and cannot be read before **2026-09-06** (see ticket 08's correction). The estimate does not need to be exact to be decisive — the gap is roughly 50×, not 2× — but whoever runs ticket 08's runbook on 2026-09-06 should record the real number while they are in the dashboard, as step 7 already has them watching the counters during a listening session.

### What landed, and the one thing no test could reach

Built 2026-08-09. The decision that Redis is authoritative here — the opposite of ticket 08's cache-only arrangement — is recorded in [ADR 0004](../../../docs/adr/0004-resume-position-store.md) rather than only in this ticket, because it is the kind of thing the next person will want to find without knowing which ticket caused it.

Storage layout now:

| what                                                 | where | written when                                            |
| ---------------------------------------------------- | ----- | ------------------------------------------------------- |
| `library/index`                                      | Blob  | a Book is added or deleted — no position on it any more |
| `library:resume` hash, three numeric fields per Book | Redis | every Sentence, atomically, newest-`updatedAt`-wins     |
| `library/<bookId>/resume`                            | Blob  | the backgrounding flush points only                     |

Resolution order when reading: Redis → the snapshot → the field left on the summary before this ticket → the start. The third rung is what stops every existing Book resetting to zero, and it can be deleted once no Book in the store predates this change.

**The Lua script has never run against the real service.** `redisResumePosition.test.js` sends it to a fake that records rather than interprets, so what is pinned is which script, keys and arguments go out — not that Redis accepts it. Two things to check the first time it runs for real: that `EVAL` returns `1`/`0` as integers rather than strings (the client's deserializers are inconsistent enough that ticket 08 was caught by exactly this), and that a second save with an identical `Date.now()` is refused rather than erroring. Neither is likely; both are cheap to look at and would otherwise present as "the resume position silently stopped moving".

Worth folding into ticket 08's 2026-09-06 runbook while the dashboard is open: the Advanced Operations figure this ticket is built on (~330/hour) was derived from `chunkText`'s sizing, never measured. A listening session now ought to move that counter by a handful rather than by hundreds, and that delta is the proof this worked.

`app/dev-preview/previewFetchMock.js` still models the pre-ticket-10 shape — it embeds `resumeIndex` in its fake index and ignores `updatedAt`/`snapshot`. It intercepts `fetch` rather than exercising the real route, so nothing is broken by that, but the preview harness and the real API now describe different things and it will mislead whoever reads it next.
