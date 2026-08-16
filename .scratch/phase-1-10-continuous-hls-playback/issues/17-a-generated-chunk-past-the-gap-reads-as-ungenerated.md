# 17 — A generated Chunk past the first gap reads as ungenerated

**What to build:** Make `isGenerated` mean what the routes claim it means — that the Chunk has
narration — for every Chunk in the Book, not only for the contiguous run at `from`. Fix it on the
Redis path, where it is free, and delete the Blob-scan fallback rather than pay for it there.

**Blocked by:** —

**Status:** resolved — verified on an iPhone 2026-08-16. The Book opened at the position it was
left, playing the right words; a forward seek and a backward seek both showed the wait and then
played what was chosen; and a reload held the position with the audio still matching. Closed
together with tickets 07, 15 and 16, which were all waiting on the same run.

Found while diagnosing why [ticket 16](16-resuming-past-a-gap-never-re-points.md)'s fix did nothing
on a real device. It is not a defect in 16, and 16 cannot work until this lands.

> **One half of the fifth criterion did not hold, and is fixed by
> [ticket 18](18-an-unnarrated-book-reads-as-a-redis-outage.md).** "An unreachable index and an
> empty one must give different answers" was true of everything this ticket wrote and false at
> the client underneath it: `hgetall` answers `null` for a key that is not there, so a Book
> nobody had narrated came back as an outage. Green here for the same reason ticket 16 was green
> on a broken app — the fixtures used `{}`, a shape the real client could not produce.

## The two routes disagree

On the Book in the store — 2,372 Chunks, 0–16 narrated, reading position at Chunk 1047:

| request                                 | answer          |
| --------------------------------------- | --------------- |
| `manifest` → `chunks[1047].isGenerated` | **false**       |
| `playlist.m3u8?from=1047`               | **11 segments** |

Chunk 1047's audio demonstrably exists: `POST /api/audio-chunks` for it answers 200 from cache,
with word boundaries for the Book's real text.

## Why

[`readIndexedRun`](../../../app/_lib/chunkIndex.js#L86) walks forward from `from` and stops dead at
the first Chunk with no duration:

```js
for (let chunkIndex = from; chunkIndex < chunkCount; chunkIndex += 1) {
  const durationSeconds = toDurationSeconds(durations[chunkIndex]);
  if (durationSeconds === undefined) break;
  run[chunkIndex] = { ... };
}
```

With `from = 0` it fills 0–16 and stops. Chunk 1047 is in the `durations` hash — already wholly in
memory, fetched by the one `HGETALL` this function is handed — and is simply never looked at. Every
Chunk past the first gap therefore comes back `undefined`, and
[`bookManifest`](../../../app/_lib/bookManifest.js#L46) turns that into `isGenerated: false`.

So the manifest reports "not narrated" for Chunks that are narrated, and it is the client's only
authority on the subject: `canPlaylistReach` reads it, and so does ticket 16's decision about
whether a re-point target exists. **Ticket 16's fix waits for a Chunk the manifest will never admit
exists.** Ticket 07's own note — "Chunks before the start are still reported with their real
`isGenerated`" — describes a property the code does not have.

## Acceptance criteria

- [x] `isGenerated` is accurate for **every** Chunk in the Book, at any `from`, on the Redis path.
- [x] The playlist's segments are **unchanged**: it still starts at `from`, still truncates at the
      first gap, still withholds `#EXT-X-ENDLIST`. The truncation lives in `buildEventPlaylist`,
      which slices and stops at the first `null` on its own, so the `break` above is redundant for
      the playlist and wrong only for the manifest.
- [x] No additional storage or Redis operations per request. The durations hash is already read in
      full; this is a loop bound, not a fetch.
- [x] The Blob-scan fallback (`readCachedChunks` / `getCachedChunks` on the read path) is removed,
      along with the code that chooses between it and the index.
- [x] A Book whose Chunk index is **unreachable** fails in a way a Listener can act on — the
      reader's existing 無法載入這本書，請稍後再試 with its retry — rather than reading as a Book
      with nothing narrated.
- [x] A Book whose index is **present but empty** still opens, and still generates from where
      reading is. An outage and a Book nobody has listened to yet must not produce the same answer.
- [x] **`readIndexedRun` stops discarding a whole index because one Chunk is missing.** Its
      `toDurationSeconds(durations[from]) === undefined` guard returns `undefined` for the entire
      read when the Chunk at `from` is not narrated, which the routes then cannot tell from "there
      is no index". A valid index must yield a run — even an entirely empty one — so the
      unreachable/empty distinction above survives as far as the route. See "The Book that cannot
      open" below.
- [x] **A Book whose Chunk 0 was never narrated opens and plays.** Reachable today: upload a Book
      and seek somewhere far before playing from the start, and ticket 15 generates only the target.
- [x] **A script rebuilds the Chunk index from what is in the bucket**, so an evicted Redis is
      recoverable without re-synthesising audio that already exists. See "There is no way back"
      below; without it this ticket is a one-way door.
- [x] `readIndexedRun`'s tests cover a Book with a gap: Chunks past it report generated when they
      are, and the playlist built from the same data still truncates.
- [x] Ticket 08's "Redis is a cache, not the source of truth" is marked superseded in place, with a
      pointer here — the same way [ticket 04](04-segment-origin-becomes-configuration.md) superseded
      its origin decision.
- [x] Re-verified on a physical iPhone together with tickets 07, 15 and 16. Done 2026-08-16 — see the four checks in the Status line.

## Comments

### The fake was more truthful than the route, which is why tests passed

Worth recording, because it is the second time in one day that a green test accompanied a broken
app. `fakeRoutes` in `AudioPlayer.test.jsx` builds its manifest as:

```js
isGenerated: generated.has(index),
```

Unconditionally accurate, for every Chunk. The real route truncates. Ticket 16's tests exercised a
manifest that tells the truth about Chunks past a gap, against a client that in production never
receives one — so the tests could not have failed, and the device could not have passed.

The fake should be corrected to truncate exactly as the routes do, **after** this ticket makes the
routes truthful; doing it before would encode the bug.

### What removing the fallback gives up

[Ticket 08](08-playlist-routes-read-one-blob-per-chunk.md) decided the opposite, and said why:

> **Redis is a cache, not the source of truth.** Per-Chunk Blob metadata stays authoritative, so an
> evicted or unavailable Redis degrades to a rebuild rather than data loss. That makes the fallback
> path load-bearing.

Removing it makes Redis a hard dependency of playback, and three things follow. They are not
objections — the decision is taken — but they are what this ticket is buying and someone should
recognise the failure when it arrives.

**An unavailable Redis stops playback**, where today it costs a slow first request. Upstash's free
tier is the store, and an outage there is now an outage here.

**An evicted Redis orphans every Chunk already narrated.** The audio stays in R2 and the index that
names it is gone, so nothing can place it. The Book reads as unnarrated and regenerates from
scratch — paying edge-tts and R2 writes again for audio that is already sitting in the bucket. That
is the failure mode worth guarding, because it is silent and it costs money rather than an error.

**A Book narrated before its index existed can no longer self-repair.** Ticket 08's step 4 relied on
exactly that: the fallback answered, and generation re-indexed as a side effect. There is no such
path afterwards.

The fifth criterion is where this has to be answered. "Redis said nothing" and "this Book has no
narration yet" are indistinguishable once the fallback is gone, and they are opposite situations:
one is an outage, the other is a new Book.

**Correcting this ticket's own first draft**, which claimed `orMiss` already tells them apart. It
does the exact opposite, deliberately, and says so: "A miss and a failure are the same outcome to
every caller, so they are the same code path." Both come back `undefined`.

The distinction does exist, one level up, at what `readIndex` returns:

| situation                                   | `readIndex`               |
| ------------------------------------------- | ------------------------- |
| Redis unreachable, or no credentials at all | `undefined`               |
| Redis answered; this Book has no index yet  | `{ base, durations: {} }` |

That is enough to build on, but it is not where the draft said it was, and `readIndexedRun`
currently flattens it again — returning `undefined` both for "no index" and for "an index that does
not cover `from`". So the signal has to be read from `index` itself rather than from the run, which
is what the sixth criterion is about.

### Not the same as reading the whole Book per poll

[Ticket 12](12-the-playlist-route-reads-the-whole-book-per-poll.md) removed a per-poll cost, and
this ticket must not put one back. It does not: the loop bound changes from "the first gap" to "the
Book's Chunk count" over an object already in memory. No I/O of any kind is added on the Redis
path, and the expensive scan is being deleted outright rather than lengthened.

### The Book that cannot open

The guard at the top of `readIndexedRun` throws away a good index whenever the Chunk at `from` is
not narrated:

```js
if (!base || !durations || toDurationSeconds(durations[from]) === undefined) return undefined;
```

Harmless today, because `undefined` means "fall back to the Blob scan" and the scan answers. With
the fallback deleted, `undefined` has to mean "Redis said nothing", and this guard would produce it
for a Book that is merely narrated somewhere other than `from` — turning a partly-narrated Book
into 無法載入這本書.

**And that Book is easy to make now.** Upload one, and seek somewhere far before ever playing from
the beginning: [ticket 15](15-the-re-point-races-the-generation-it-asked-for.md) generates the
target alone, so Chunk 0 is never narrated and `from=0` hits this guard on every launch afterwards.
So this is not defensive tidying — it is the difference between this ticket fixing playback and
bricking a Book.

### There is no way back

Today an evicted or wiped Redis is survivable: the Blob scan answers, and generation re-indexes as a
side effect, so the index heals itself. That is the property being deleted, and nothing replaces it.

Afterwards, a wiped index means every already-narrated Chunk is unreachable — the MP3s sit in R2
under keys nothing can name — and the Book regenerates from scratch, paying edge-tts and R2 writes
for audio that already exists. It fails silently and it costs money, which is the worst combination
to leave unguarded.

A rebuild script closes it: walk the bucket's prefix for a Book and voice, read each object's
duration the way `mp3Frames.js` already does, and write the durations hash back. It needs no new
concepts and it is the only thing that makes this decision reversible, which is why it is a
criterion here rather than a nice-to-have filed elsewhere.

### What it turned out to also be

The ticket described Chunks _past_ the first gap. The manifest route's own test caught a second
half nobody had noticed: Chunks _before_ `from` were equally invisible, because the loop started
there. Ticket 07 states the opposite as fact — "Chunks before the start are still reported with
their real `isGenerated`, which is what the client's reachability check reads" — and it was not
true either.

It matters for ticket 07's own backward seek. A target before the playlist's start is unreachable
by definition, so it can only be re-pointed to, and the client can only decide to do that if it is
told the Chunk exists. So `from` now decides where the timeline begins and nothing else;
`buildEventPlaylist` was always the thing that ignored everything earlier.

### Confirmed against the real store

The Book the bug was found on, read through the fixed routes:

- `chunks[1047].isGenerated` is now **true**.
- The narrated runs are `0–16`, `1047–1057`, `1414–1424`, `1482–1492`, `1626–1636`, `1896–1906`,
  `2100–2110` — **six long seeks that each narrated audio the app then could not see**. All of it
  was in R2 the whole time.
- `playlist.m3u8` from 0 still serves 17 segments. The truncation is untouched.

### The way back, and why it drives the app

`scripts/reindex-book.mjs` lists a Book's prefix, keeps the Chunks that already have metadata in
the bucket, and asks `/api/audio-chunks` for exactly those. A playable cached Chunk is answered by
indexing it and returning, with no TTS call, so this repairs an index without re-synthesising
anything — and requesting only what the listing found is what stops it generating a 2,372-Chunk
Book from scratch.

It goes through the running app rather than writing to Redis directly because the cues half of the
index is derived from the Chunk text, and a plain Node script cannot import that module. Copying
the derivation would mean a second implementation whose output must match the first exactly — the
same shape of mistake that let this ticket hide behind a green suite for a day. The app owns it.

### The fake, corrected in intent rather than in code

`fakeRoutes` reports `isGenerated` for every Chunk and `startSeconds`/`sentences` only for placed
ones. That was wrong against the old routes and is right against the new ones, so no assertion
changed — but the split is now stated in a comment, because "the fixture happened to describe the
behaviour we were about to build" is not something the next reader should have to infer.
