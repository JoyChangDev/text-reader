# 08 — The HLS routes read one blob per Chunk, and the store rate-limits them

**What to build:** Stop `readCachedChunks` fanning out one Blob read per Chunk of the whole Book on every playlist and manifest request. Both routes need a single read of a per-(Book, voice) index instead.

**Blocked by:** —

**Status:** ready-for-agent

Found by running the real dev server against the live Blob store while trying to close ticket 04's last item. It is a blocker for that item and for ticket 06, and it is not a storage misconfiguration — the app is doing it to itself.

## Before you start — read this, don't re-derive it

Everything below was measured on 2026-08-07. If you are picking this up on a different machine, or in a fresh session, these four things will otherwise cost you an hour.

**The store's 403s are this ticket's own bug, not a misconfiguration.** They are caused by the fan-out below, so the fix is this ticket, not a setting. Above all, do not run repeated fan-out reads to "confirm" it; that is what causes it.

> **Corrected 2026-08-08 — the mechanism below is wrong, and "wait half an hour" is wrong.** This section used to say the quota had been "checked and ruled out". It had not: what was checked was **Storage** (1.5% of 1 GB), the one metric never under pressure. The metric that actually blew is **Simple Operations — 11.3k against a 10k monthly allowance**, and every `storageClient.get()` spends one. At 1,983 reads per request, roughly five playlist requests exhaust a month.
>
> Consequences for anyone picking this up: a 403 from Blob **does not** distinguish quota exhaustion from the platform firewall — a single quiet `get()` 403s under quota exhaustion just as a burst does. And exhaustion does **not** clear in half an hour; it clears on the billing cycle (**access resumes 2026-09-06**). Read the dashboard's four metrics, not one. See [ticket 09](09-blob-usage-indicator-costs-an-advanced-operation.md) for the readings and for the same bug shape in the capacity indicator.
>
> This also raises what stage 2 is for. Stage 1 makes a poll cost the length of the generated run, which **grows over a listening session** — several hundred Simple Operations per poll by mid-Book, against 10k a month. Stage 2 takes the polled path to **zero** Blob operations. That is not a performance improvement; on Hobby it is the difference between the app working and not.

**Local dev works against the real Blob store, but `.env.local` is gitignored.** A fresh clone has no `BLOB_READ_WRITE_TOKEN`, so every route 502s until you run `vercel env pull`. `.claude/launch.json` is committed, so `npm run dev` on port 3100 is already wired.

**The `vercel` CLI may not be installed** — it was not on the machine this was written on. `vercel install upstash` needs it, or use the Marketplace in the dashboard instead.

**Verifying stage 1 costs one request, not a sweep.** Call the playlist route once for a Book with a few thousand Chunks and look at the wall time: 5.4s before, well under a second after. Do not loop.

## What happens

[`readCachedChunks`](../../../app/_lib/audioGenerationService.js) issues one `storageClient.get()` per Chunk index, all at once:

```js
return Promise.all(
  Array.from({ length: chunkCount }, (_, chunkIndex) =>
    storageClient.get(cacheKey({ bookId, chunkIndex, voice })),
  ),
);
```

`storageClient.get()` is an unauthenticated HTTPS fetch of a public blob URL. So for the Book currently in the store — 1,983 Chunks — **one request to `/api/books/[bookId]/playlist.m3u8` fans out into 1,983 simultaneous fetches of the Blob store.** The manifest route does the same, and then runs `deriveSentenceSpans` over all of it.

The playlist is an EVENT playlist. The media stack re-fetches it continuously during playback, precisely so it can discover new segments. Every one of those polls costs another full fan-out. The cost is O(Book length) per poll and grows as Books get longer, which is backwards — a longer Book should not make each poll more expensive.

## Measured

|                                                                |                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/api/books/…/playlist.m3u8` on a 1,983-Chunk Book             | **200 OK in 5.4s** (4.7s in application code)                    |
| Public blob URL fetch, single, while quiet                     | 200 OK, real MP3 bytes                                           |
| Public blob URL fetch, single, right after a route call        | **403 Forbidden**                                                |
| Same, re-probed every 30s for 3 minutes                        | 403 the whole way                                                |
| `list()` / `head()` via the authenticated Blob API, throughout | 200, never once blocked                                          |
| Store usage                                                    | 1.5% of quota — not exhaustion                                   |
| Store type                                                     | `*.public.blob.vercel-storage.com` — public, not a private store |

The store has Firewall enabled, and [Vercel Blob's security docs](https://vercel.com/docs/vercel-blob/security) say Blob is behind a platform-wide firewall that "blocks abnormal or suspicious levels of incoming requests". 1,983 parallel unauthenticated reads is that. The authenticated API is unaffected, which is exactly the split observed.

Recovery is not quick: still 403 after three minutes of quiet, recovered after roughly half an hour.

> **Superseded — see the correction at the top.** Two claims in this section did not survive: `storageClient.get()` is not an unauthenticated public fetch (it is passed a token, and spends a Simple Operation per call), and the half-hour recovery above describes at most a transient episode, not the state the store is in. The reading it was inferred from was **Storage**; the metric that actually blew is **Simple Operations**, which recovers on the billing cycle. Do not plan around half an hour.

## Why this matters beyond being slow

The failure is **intermittent and looks like something else**. During ticket 06 on a physical device it would present as playback stopping at a segment boundary after a period of listening — indistinguishable from the background-playback failure that whole ticket exists to measure. It would have cost a lot of time to attribute correctly, and could easily have been recorded as an EVENT-playlist finding in ADR 0003 that was never true.

It also means ticket 04's remaining item cannot be honestly checked off: segments do fetch correctly from real Vercel Blob URLs (verified — real MP3 bytes, 200) but only when the store is not busy being rate-limited by our own routes.

- [x] A playlist or manifest request costs a bounded number of Blob reads, independent of how many Chunks the Book has. _Done in stage 1 for the normal case — the cost is now the length of the generated run, not the Book. A fully-narrated Book is still O(Book); that is what the Redis index in stage 2 closes._
- [x] Generating a Chunk updates whatever index the routes read, so a growing Book still grows the playlist — the EVENT playlist's whole mechanism depends on it. _Every path through `getOrGenerateAudio` that ends in playable audio writes the index, and the write is awaited so the poll that follows cannot read a short run._
- [x] The index carries what `isPlayableChunk` needs (`url`, `durationSeconds`) and what the manifest needs (`boundaries`), or the routes stay O(Chunk) for the data they can't get from it. _`url` is derived rather than stored, and the manifest gets pre-derived spans instead of `boundaries` — see the decisions above._
- [x] A Chunk cached before `durationSeconds` existed is still reported ungenerated, so ticket 02's lazy re-measurement still triggers. _`writeChunk` refuses to index a Chunk whose duration could not back a segment, applying `isPlayableChunk`'s rule before the entry exists rather than after._
- [ ] The playlist route responds in well under a second on a ~2,000-Chunk Book. _Blocked until 2026-09-06: populating the index needs generation, which needs Blob. Step 6 of the runbook at the bottom of this ticket._
- [ ] A full listening session's worth of playlist polls does not trip the store's rate limiting — verified against the real store, not a fake. _Same block. The polled path now makes no Blob call at all when the index answers, which is the claim to test. Step 7 of the runbook._
- [x] `readCachedChunks`'s existing behaviour stays covered: one entry per Chunk index, `undefined` where not cached, never synthesizing. _Untouched by stage 2; it is now the fallback rather than the only path._

## Comments

### Design — decided

Two facts settled the shape.

**Blob URLs are derivable, so the index never stores them.** `cacheKey` is `${bookId}/${chunkIndex}/${voice}` and `put` uses `addRandomSuffix: false`, so a segment URL is a pure function of (store, Book, Chunk, voice).

**Vercel Blob has no compare-and-swap.** In `@vercel/blob@2.6.1`, `ifMatch` exists only on the delete options ("Can only be used when deleting a single URL"); `put` takes `PutCommandOptions`, which adds only `multipart`. So a shared index blob under the look-ahead's parallel writers would lose updates undetectably. An index in Blob is therefore out, and `list()` is out too — it is an Advanced Operation, 2,000/month on Hobby, so it cannot be on a polled path.

**The index goes in Redis (Upstash, via the Vercel Marketplace).** A small, hot, mutable, concurrently-written index is a database shape, not an object-storage shape. `HSET` writes a single field atomically, so generation needs no read-modify-write and no retry loop at all. Audio itself stays in Blob.

Two hashes per (Book, voice), because their read frequencies differ by orders of magnitude:

| key                               | field → value                       | read by                                  | size                                                         |
| --------------------------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `book:{bookId}:{voice}:durations` | chunkIndex → `durationSeconds`      | playlist, `HGETALL`                      | ~14 KB at 2,000 Chunks                                       |
| `book:{bookId}:{voice}:cues`      | chunkIndex → derived Sentence spans | manifest, `HMGET` for placed Chunks only | ~130–450 KB whole, but only the placed range is ever fetched |

**Cues store derived spans, not `boundaries`.** Measured on the live store, per-Chunk metadata averages 3,561 bytes and is almost entirely word-level `boundaries` — ~7 MB across 2,000 Chunks. The manifest never returns `boundaries`; it returns what `deriveSentenceSpans` makes of them, roughly four Sentences of two numbers each. Deriving at generation time is a 20–50× reduction _and_ takes `deriveSentenceSpans` off the request path, which is most of the 4.7s the manifest route currently spends in application code. `boundaries` stays in the per-Chunk Blob as the raw record.

**Redis is a cache, not the source of truth.** Per-Chunk Blob metadata stays authoritative, so an evicted or unavailable Redis degrades to a rebuild rather than data loss. That makes the fallback path load-bearing, which is why the first checklist item below is worth doing on its own even before Redis exists.

### Staging

1. **Stop reading past the first gap.** — **done**, see the notes below. The playlist truncates there, so everything beyond it is read for nothing. Reading from `from` until the first miss costs O(contiguous generated run) instead of O(Book): 12 reads instead of 1,983 on the Book currently in the store. No new state, no service, no migration — and it is exactly the shape the Redis-miss fallback needs, so it is not throwaway.
2. **Add the Redis index.** Needs Upstash provisioned first (`vercel install upstash`, or the Marketplace in the dashboard) — credentials are injected as environment variables, so this cannot land until that exists.

### Stage 1 notes

`readCachedChunks` now scans forward from `from` in batches of 16 and stops at the first Chunk that isn't playable. Batched rather than one at a time because a strictly sequential scan would cost a round trip per Chunk; 16 covers the whole look-ahead window in one trip while staying far below what looks like abnormal traffic.

**`from` moved into `readBookAudio`, and `parsePlaylistStart` with it.** The scan has to start where the playlist starts, or a Listener who jumped over an ungenerated stretch (ticket 07) would stop at the gap they already jumped past and get an empty playlist. Validating `from` needs the Book's length, so it can only happen after the lookup — which is also why it belongs there rather than in each route. Both routes lost their duplicated preamble as a result, and the "the two routes must agree about `from`" property is now structural instead of conventional.

**One semantic change, deliberate.** A Chunk stored beyond the first gap now reports `isGenerated: false`, because nothing looked at it. That is already what the playlist concludes — it truncates at the gap — and ticket 07's client re-points rather than waiting for a timeline that can never reach it. Nothing regenerates unnecessarily either: `getOrGenerateAudio` checks the cache before synthesizing, so a Chunk that really is stored comes back from cache without touching edge-tts.

Two route tests were leaking `mockResolvedValueOnce` values — they queued a `getCachedChunks` result the route never consumed, which then spilled into whichever test ran next. Both now assert `getCachedChunks` was never called, which is the behaviour worth pinning anyway.

**Not yet verified against the real store, and cannot be until 2026-09-06.** Requests fail at the very first read, before any of the new code runs. This originally said "recovery took roughly half an hour last time" — that is wrong, see the correction at the top: the store is over its **Simple Operations** allowance (11.3k / 10k) and access resumes on the billing cycle, **2026-09-06**. Do not keep retrying before then; every attempt is another operation against a quota that is already spent. On that date, re-run the playlist route against the live store; the number to look for is a response well under a second where it was 5.4s.

### Stage 2 — in progress since 2026-08-08

Upstash is provisioned (Vercel Dashboard → project → Storage → Create Database, not the Marketplace "Install" button, which links an existing account, and not "Build with v0", which is unrelated). Don't re-derive the following.

**The credentials arrive under the legacy Vercel KV names.** `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`. So `@upstash/redis`'s `Redis.fromEnv()` **does not work** — it looks for `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. Construct the client explicitly from the `KV_REST_API_*` pair. `REDIS_URL`/`KV_URL` are TCP connection strings; don't use them, the REST client is the right shape for serverless.

**Getting them locally needs `vercel link` first.** `vercel env pull` fails with "Your codebase isn't linked to a project" until then, because `.vercel/project.json` is gitignored. On `vercel link`, answer **yes** to "Link to existing project?" — answering no silently creates a new empty one. `env pull` overwrites `.env.local` rather than merging.

**The client's return types are not consistent between commands.** Probed against the real service: the same hash values come back as strings from `HGETALL` and as numbers from `HMGET`. Coerce with `Number()`; a string reaching the playlist builder renders as `#EXTINF:"12.5"`.

> **Mechanism confirmed 2026-08-09, from the installed client's source** — `node_modules/@upstash/redis/chunk-K7RP6Y36.mjs`, `deserialize4` (HGETALL) and `deserialize5` (HMGET). It is not really HGETALL vs HMGET, it is integer vs float: HGETALL returns the **raw string** for any value that parses as a number but isn't a safe integer, and `JSON.parse`s everything else — so `"12"` arrives as `12` and `"12.5"` arrives as `"12.5"`, from the same call. HMGET `JSON.parse`s unconditionally. The `Number()` coercion in `toDurationSeconds` is therefore load-bearing on the common case, not defensive padding.
>
> **`HMGET` resolves to an object keyed by field name, not an array in request order** — and to `null`, not an object of nulls, when every field is missing. Reading the result by position appears to work and silently breaks the moment the Chunks asked for don't start at 0, which is exactly the ticket-07 jump. This bug was written and caught in review; the test fake had been returning an array, which hid it. `redisChunkIndex.test.js`'s fakes now mirror the real shape, and there is a regression test named for it.

**Where the segment URL's origin comes from — decided.** The design above settles that URLs are derivable and so are never stored, but not where the store origin comes from. It is recovered from a real `put` response and recorded once, rather than parsed out of `BLOB_READ_WRITE_TOKEN` (undocumented token format) or configured as a second env var. Storing URLs in the index instead would put ~220 KB on a continuously polled path at 2,000 Chunks — this ticket's own cost, moved to Redis.

Done so far: [chunkIndex.js](../../../app/_lib/chunkIndex.js), the pure half — `readIndexedRun` turns an index read into the same shape `readCachedChunks` returns, scanning from `from` to the first gap. A miss is `undefined` meaning "ask Blob", deliberately distinct from an empty run meaning "nothing is generated", because the index is a cache and must never be able to convince a route that a fully-narrated Book is empty.

**The free tier fits, and the index shape does not have to change — settled 2026-08-09, don't re-derive it.** This was item 5, and it gated the other four. Upstash's free tier is **500K commands/month** and **10 GB/month bandwidth** (256 MB data, 10 MB max request). Against a continuously polled playlist:

| cost                                                  | per poll | ceiling on the free tier            |
| ----------------------------------------------------- | -------- | ----------------------------------- |
| commands — pipelined `HGETALL` + origin `GET`         | 2        | ~400 h/month of continuous playback |
| bandwidth — durations hash as REST JSON, 2,000 fields | ~36 KB   | ~460 h/month                        |

Both computed against the largest Book in the store (1,983 Chunks) and a 12s target duration, reloading every half target duration — the fastest RFC 8216 §6.3.4 asks for. `chunkText` caps a Chunk at 200 chars / 4 sentences, so real Chunks run longer and are polled less often than that. Neither ceiling is reachable by one Listener.

The table prices **the polled path only**, which is the one that can run away. The other two paths are bounded by generation rather than by time: `writeChunk` pipelines **3** commands per Chunk (two `HSET`s and the origin `SET`), so indexing a whole 2,000-Chunk Book costs ~6K; and the manifest adds a third command plus a slice of the cues hash, but it is fetched when Chunks generate, not on a timer. Both are noise against 500K.

**The two worst cases cannot happen at once, which is what makes `HGETALL` the right command rather than a windowed `HMGET`.** Bandwidth per poll grows with the generated run — but the playlist stops being polled at the exact moment that run covers the rest of the Book, because that is when `buildEventPlaylist` emits `#EXT-X-ENDLIST`. The full-hash read and the continuous poll exclude each other. Reading a window instead would also have to guess the run's length before reading it, which is the thing the read is for.

So: index as designed, client poll interval untouched, playlist stays `no-store`.

All four remaining items landed on 2026-08-09:

1. **The Redis I/O** — [redisChunkIndex.js](../../../app/_lib/redisChunkIndex.js). `HGETALL` durations plus the origin `GET` in one pipeline; `HMGET` cues for placed Chunks only.
2. **Generation writes the index** — `indexChunk` in [audioGenerationService.js](../../../app/_lib/audioGenerationService.js), deriving Sentence spans at generation time.
3. **`readBookAudio` reads the index** — [bookAudio.js](../../../app/_lib/bookAudio.js), falling back to the stage 1 Blob scan on a miss.
4. **`bookManifest` takes pre-derived spans** — `deriveSentenceSpans` is gone from [bookManifest.js](../../../app/_lib/bookManifest.js) entirely.

### Stage 2 — decisions made while building it

Six things were settled in code that the design above did not cover. They are cheap to get wrong and expensive to rediscover.

**A cache hit is indexed too, not just a generation.** Nothing else ever writes the index, so a Book narrated before the index existed — or one whose index was evicted — is re-indexed only by the Listener reading through it again. Without this, "an unavailable Redis degrades to a rebuild" would have been aspirational: a fully-narrated Book with an empty index would fall back to the Blob scan forever, which on a complete Book is the O(Book) fan-out this whole ticket exists to remove.

**The index write is awaited, not left in flight.** The client generates a Chunk and then the playlist is polled for it. An index that is one Chunk short reads as a **hit**, not a miss — so nothing falls back to Blob to correct it, and the Chunk is simply absent from the playlist until the next poll. Awaiting is safe because the write swallows its own failures.

**Cues are stored as bare `[start, end]` pairs.** `deriveSentenceSpans` also returns each Sentence's text; nothing downstream reads it and the text is already in the Book's chunks blob, so storing it would roughly quadruple the hash the manifest pulls over the network. `deriveCueSpans` in [sentenceSpans.js](../../../app/_lib/sentenceSpans.js) is the one place that shape is decided, so the index path and the Blob fallback cannot disagree about it.

**A placed Chunk with no stored cues sends the whole manifest lookup back to Blob**, rather than reporting that Chunk as having no Sentences. Its audio is on the timeline either way, so the alternative is a stretch of Book that plays with no highlighting and nothing to indicate why. Durations and cues are written in the same pipeline, so the two disagreeing means the index is damaged.

**The origin is re-`SET` on every write rather than written once behind an `NX`.** It costs one command per generation and never per poll, and a store whose origin ever changed would otherwise serve derived URLs into a store that has moved, permanently.

**`needsCues` is a parameter of `readBookAudio`, not something it works out.** It is a property of what the caller will do with the answer — the manifest route passes it, the playlist route does not, and that is the whole reason the polled path never touches the cues hash.

### Stage 2 — what is verified and what is not

Verified by unit test: the index answers with zero Blob reads; a miss, an eviction and an unreachable Redis are one code path; cues are read for placed Chunks only and never for the playlist; the Blob fallback derives the spans the index would have stored; generation indexes on all three of its success paths and on none of its failure ones; a Chunk with no usable duration is still refused an index entry, so ticket 02's lazy re-measurement still triggers.

**Not exercised against a live index, and cannot be before 2026-09-06.** Populating the index requires generating a Chunk, which requires Blob, which is over its Simple Operations allowance. The two live-store criteria therefore stay open.

What _was_ closed without the network: the client's deserializers were read from the installed source rather than assumed, which is what turned up the `HMGET`-keyed-by-field-name bug — see the correction under the credentials notes above. `toCueSpans` still accepts both a JSON string and an already-parsed array; that is a deliberate tolerance rather than an unresolved question, since `HGETALL` and `HMGET` genuinely disagree about when they parse. Don't "simplify" it away.

### Stage 2 — the runbook for 2026-09-06

Written on 2026-08-09, for whoever picks this up on or after the day the Blob allowance resets. It closes the two open checklist items and the handful of things no unit test can reach. Work through it in order; several steps exist to stop you spending the fresh allowance on the wrong thing.

**Read this first: every step below is a single request, deliberately.** The whole ticket exists because a burst of reads exhausted a monthly quota in about five requests. Do not loop, do not "confirm" a result by repeating it, and do not open the app and click around until step 5. If a step's number looks wrong, read the next step before re-running the last one.

**0 — Check the allowance actually reset, before touching anything.** Vercel Dashboard → project → Storage → the Blob store → Usage. Read **all four** metrics; the one that matters is **Simple Operations**, which was 11.3k against a 10k allowance. Storage (~5 MB / 1 GB) and Data Transfer (~127 MB / 10 GB) were never under pressure and tell you nothing. If Simple Operations has not reset to near zero, stop — nothing below will work and every attempt spends the next month's allowance. Note the starting figures for all four; steps 4 and 5 are deltas against them.

**1 — Get the credentials.** `.env.local` is gitignored and `.vercel/project.json` with it, so a fresh clone has neither:

```bash
npx vercel link && npx vercel env pull
```

Answer **yes** to "Link to existing project?" — answering no silently creates a new empty one. `env pull` overwrites `.env.local` rather than merging. Confirm it brought down `BLOB_READ_WRITE_TOKEN` **and** `KV_REST_API_URL` / `KV_REST_API_TOKEN`; without the second pair the index is silently disabled and every measurement below just re-measures stage 1.

**2 — Start the dev server.** `.claude/launch.json` is committed and wires `npm run dev` to port 3100.

**3 — Establish how you will tell the index from the fallback.** There is no runtime signal that says which source answered — that is by design, both return the same shape. So the only honest instrument is the two counters, read either side of one request:

- **Vercel Blob → Simple Operations**: the claim is that a playlist poll served from the index adds **zero**.
- **Upstash → the database's command count**: the same poll should add **2** (`HGETALL` + origin `GET`).

Response time is a proxy, not proof — a warm Blob scan over a short generated run is also fast.

**4 — Cold start: the fallback still works, and re-indexes.** The Book in the store was narrated before the index existed, so its index is empty and the first request must fall back. Request the playlist once for a Book and voice you know is generated. Expect: it succeeds, Blob Simple Operations goes up by roughly the length of the generated run, Upstash's count goes up by 2 (one miss). This is stage 1's cost and is the correct answer here — a fast response would mean the index was somehow already populated and you are not testing what you think.

**5 — Generate a few Chunks, so there is an index to read.** Open the Book in the app and let it narrate ~10 Chunks, or POST `/api/audio-chunks` for a handful of indexes directly. Each generated Chunk should add **3** Upstash commands. Then re-request the playlist: Blob Simple Operations should now add **zero**, and Upstash **2**. That is the ticket's central claim, and it is the first point at which it has ever been observed.

**6 — Close "the playlist route responds in well under a second on a ~2,000-Chunk Book."** The number to beat is **5.4s** (4.7s of it in application code). Time one request against the ~1,983-Chunk Book. Note that this only means anything once that Book's index covers a decent run — on a cold index you are timing step 4, not this.

**7 — Close "a full listening session's worth of playlist polls does not trip the store's rate limiting."** Listen for a stretch on a real device, long enough to cross several Chunk boundaries with the app backgrounded (this is also ticket 06's shape). Then read the counters: **Blob Simple Operations should be flat except for the Chunks that were newly generated**, and no read should 403. A rising Blob count during steady playback means the index is missing on every poll — go to step 8 rather than concluding the ticket failed.

**8 — The four things no test could reach.** All of these are cheap to check once you are here, and all of them were guessed at from the installed client's source rather than observed:

- **Durations survive the round trip as numbers.** `HGETALL` returns the raw string for a non-safe-integer and `JSON.parse`s everything else, so a Book with both integer and fractional Chunk durations exercises both. A failure here shows up as `#EXTINF:"12.5"` in the playlist body — read the response text, don't just check the status.
- **`HMGET` is keyed by field name.** Request the **manifest** with `?from=` set to a Chunk part-way in, and confirm the Sentence cues come back rather than an empty `sentences` array. This is the bug review caught; the unit test pins it against a fake, this pins it against the service.
- **Derived segment URLs actually resolve.** Take one URL out of the playlist body and fetch it once. Expect 200 and real MP3 bytes. This is what proves the origin recovered from a `put` response is the right origin.
- **The manifest's cue times still line up with playback.** Play a little and watch the Sentence highlighting; the spans are now derived at generation time rather than per request, so a systematic offset would be new.

**9 — Update this ticket.** Tick the two checklist items with the measured numbers, or record what actually happened if they did not hold. Ticket 09's note that `/api/library` is requested three times per home page load is also unblocked once the store is readable, and wants its own ticket.
