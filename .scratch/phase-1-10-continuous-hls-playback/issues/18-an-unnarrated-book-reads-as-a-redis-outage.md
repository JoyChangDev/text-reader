# 18 — A Book nobody has narrated reads as a Redis outage

**What to build:** Make `readIndex` keep the promise its own callers are written against. A Book
with nothing narrated must come back as an index that answered and holds nothing, not as an
index that could not be read.

**Blocked by:** —

**Status:** resolved — 2026-08-16. Both routes measured against the live Upstash, before and
after (see "Measured, not inferred"), and the one question left open — whether a brand-new Book
plays without a refresh — **was run on the device and passed**. See "The empty playlist at first
load is fine" at the bottom, which is a finding in its own right and not only this ticket
closing.

Found on 2026-08-16 while closing
[phase 1.11's ticket 06](../../phase-1-11-object-storage-migration/issues/06-a-failed-write-reads-as-an-empty-book.md),
which is a ticket about a failed write reading as a plausible absence. This is the same shape
with the two swapped: an absence reading as a failure.

## What is there

[`bookAudio.js`](../../../app/_lib/bookAudio.js) writes the contract out in full, because
[ticket 17](17-a-generated-chunk-past-the-gap-reads-as-ungenerated.md) removed the Blob scan
that used to make the distinction cost nothing:

```
readIndex -> undefined           Redis said nothing. An outage, or no credentials.
readIndex -> { durations: {} }   Redis answered. This Book has no narration yet.
```

The second line is not reachable. [`redisChunkIndex.js`](../../../app/_lib/redisChunkIndex.js)
returns `{ base, durations }` with whatever `hgetall` gave it, and `@upstash/redis` types that
as `TData | null` — its `deserialize` returns `null` the moment the reply array is empty, which
is what Redis sends for a key that does not exist. **Redis has no empty hash:** it drops a hash
when its last field goes, so "the key is there and holds nothing" is not a state that can be
observed.

Confirmed against the live Upstash on 2026-08-16 rather than read off the types — one
`hgetall` against a key that was never written:

```
typeof   : object
value    : null
is null  : true
is {}    : false
```

So for a Book with nothing narrated: `durations` is `null`,
[`readIndexedRun`](../../../app/_lib/chunkIndex.js)'s `if (!base || !durations)` returns
`undefined`, `readBookAudio` turns that into `{ unavailable: true }`, and both HLS routes answer
**502 — "the Chunk index could not be read"**. Which is a lie: it was read perfectly well, and
the answer was "nothing yet".

## Why the suite is green

Every test that exercises the empty case builds the index as `indexed({})` — a truthy empty
object, in the route tests and in `readIndexedRun`'s own. That is a shape the real client cannot
produce for a Book with nothing in it. The fixture is more truthful than the thing it stands in
for, which is the exact failure mode
[ticket 17 wrote up](17-a-generated-chunk-past-the-gap-reads-as-ungenerated.md#the-fake-was-more-truthful-than-the-route-which-is-why-tests-passed)
under "The fake was more truthful than the route, which is why tests passed". Second time.

## Acceptance criteria

- [x] `readIndex` answers `{ base, durations: {} }` for a (Book, voice) that has never been
      narrated, and keeps answering `undefined` when Redis genuinely could not be reached. The
      two are different answers as far as the routes, which is the whole of ticket 17's fifth
      criterion.
- [x] Covered by a test at the seam that failed — a fake whose `hgetall` resolves `null`, which
      is what the real client does. A test that passes `{}` does not test this.
- [x] The empty-Book tests that use `indexed({})` are looked at: either they are describing a
      state the client can actually produce, or they are corrected. Deciding they are fine is a
      valid outcome; not looking is what let this through.
- [x] `readCues` is checked for the same defect. `hmget` deserializes to `null` when every field
      it asked for is missing, and `withIndexedCues` reads `values?.[chunkIndex]` — work out
      whether that path reports a damaged index for a Book that simply has no cues yet, and say
      so either way.

## What it costs today

> **Answered on the device, 2026-08-16.** The question this section refused to settle — what a
> brand-new Book's first playlist does — was run and passed: it plays, with no refresh. The
> paragraph below stands as written because the caution was right at the time; see
> "The empty playlist at first load is fine" for what was actually observed.

Self-healing, which is why it has not been loud: the first Chunk to generate creates the hash,
and every read after that is ordinary. What it costs is the window before that.

**The manifest read on a newly opened, never-narrated Book fails.** `useBookPlayer` logs it and
carries on, so `generatedChunksRef` stays empty and no cues are placed until the next read — and
there is a next read, on `readyChunkCount`, so this heals within a Chunk.

**The playlist is the one worth thinking about, and this ticket does not settle it.** `src` is
assigned once, and the element is given a 502 instead of a playlist. What an element does with
that, and whether it recovers, is the same question
[ticket 15](15-the-re-point-races-the-generation-it-asked-for.md) answered for a playlist that
is well-formed but empty — "an empty source it errors on and never recovers from". Fixing this
ticket turns the 502 into that empty playlist. That is strictly more correct and may well not be
enough; **what a brand-new Book's first playlist does on a device is not established here and
should not be claimed.** If it turns out an empty playlist at mount is also a dead element, that
is its own ticket and it is about `preload="auto"` and the one-shot `src` assignment, not about
Redis.

## Comments

### What was built

One `?? {}` in `readIndex`, with the reasoning at the line, and a test whose fake `hgetall`
resolves `null`. The test was confirmed to fail against the old line before the fix went in —
worth saying, because the entire defect is that a test which looks like it covers this passes
either way.

### Measured, not inferred — 2026-08-16

Reproducing this needs a (Book, voice) with nothing narrated, and that does **not** need an
upload or a single TTS call: the index is keyed by both, so **an existing Book in a voice it was
never narrated in is exactly the state**. `book:<id>:zh-TW-YunJheNeural:durations` has never been
written for any Book here, and the routes are read-only, so this costs nothing and changes
nothing.

Against 戰神(上) (2,372 Chunks, narrated in `zh-TW-HsiaoChenNeural` only), on the dev server
wired to the real Upstash and the real R2:

| request                             | before      | after       |
| ----------------------------------- | ----------- | ----------- |
| `playlist.m3u8?voice=YunJhe` (none) | **502**     | 200         |
| `manifest?voice=YunJhe` (none)      | **502**     | 200         |
| `playlist.m3u8?voice=HsiaoChen`     | 200, 17 seg | 200, 17 seg |

The "before" column is the committed line with `?? {}` taken back out, against the same store
minutes apart — so this is the defect itself, not a reconstruction of it. The narrated voice is
the control: unchanged, and still 17 segments.

**What the element now receives for an unnarrated Book**, in full:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-MEDIA-SEQUENCE:0
```

Well-formed, EVENT, no `ENDLIST`, and no segments. Which is precisely the source
[ticket 15](15-the-re-point-races-the-generation-it-asked-for.md) found an element "errors on and
never recovers from" — so this measurement confirms the fix and sharpens the open question at the
same time. It does not answer it: ticket 15 saw that on a playlist the element was re-pointed at
mid-session, and this one is the element's first load. Whether those behave the same is the thing
still wanting a device.

### The other two criteria, answered rather than changed

**`readCues` has the same null and does not have the same bug.** Two things stop it. A Book with
nothing narrated places no Chunks, so `withIndexedCues` asks for none, and `readCues` returns
`[]` before issuing a command — it never sees the null at all. And when it does see one, every
field it asked for was missing while `durations` claimed those Chunks were placed, which is the
two hashes disagreeing; they are written in the same pipeline, so that is a damaged index and
failing the lookup is deliberate (the comment in `bookAudio.js` says so). There was already a
test for the shape, `reports every Chunk as uncued when the hash has none of them`, built on
`fakeRedis([null])`. Nothing to change.

**The `indexed({})` fixtures are correct now, and were wrong before.** They mock `readIndex`, so
they assert against what that method promises rather than what Redis hands it — and as of this
ticket the promise is kept, so `{}` is exactly what a never-narrated Book produces. They were
describing an unreachable state until the fix landed. Left alone, deliberately: correcting them
to `null` would push the defect down into the routes, which are entitled to trust the contract.

`chunkIndex.test.js` already pins the other half —
`readIndexedRun({ base, durations: null })` is asserted to be `undefined`. That test stays, and
it is the reason the fix does not belong there.

### The empty playlist at first load is fine — 2026-08-16, on the device

The question the rest of this ticket deliberately refused to answer. **A newly uploaded Book
plays without a refresh.** So the empty EVENT playlist this fix now serves is a source the
element accepts and keeps re-fetching until segments appear — which is what an EVENT playlist
with no `ENDLIST` is supposed to mean, and it turns out to be true in practice as well as on
paper.

That closes the ticket, and it also settles the worry in "What it costs today" the other way:
turning the 502 into an empty playlist was not merely more correct, it was sufficient. No
follow-up ticket about `preload="auto"` or the one-shot `src` assignment is needed.

**It does not generalise to [ticket 15](15-the-re-point-races-the-generation-it-asked-for.md),
and the difference is worth keeping.** That ticket found an empty playlist to be a source the
element "errors on and never recovers from", and that finding stands — it was a **mid-session
re-point**, where `src` is reassigned on an element that has already loaded and played something.
This is the element's **first** load. The two behave differently, which is now observed rather
than assumed; _why_ they differ is not established here and nobody should write it down as though
it were. What follows for the code is only this: `seekToSentence`'s wait for the awaited Chunk is
still load-bearing, and "an empty playlist is harmless, we saw it work" is not a reason to
simplify it away.

## Do not fix this in `readIndexedRun`

The tempting one-liner is to have `readIndexedRun` treat a null `durations` as `{}`. It is the
wrong place twice over. That function is the pure half and its guard is deliberate — its comment
says it "takes whatever it is handed", and a run built on a missing base or missing durations is
the plausible-but-wrong answer the guard exists to refuse. And the null does not originate there;
it originates at the client, which is also where the contract it breaks is documented. Normalise
where the I/O is, and let the pure half keep refusing nonsense.
