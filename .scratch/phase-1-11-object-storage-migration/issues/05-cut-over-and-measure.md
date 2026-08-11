# 05 — Cut over, and measure what a Book actually costs

**What to build:** Point the deployed app at R2, clear the Library of abandoned test data, narrate a Book end to end, and record what it cost. Then unblock phase 1.10's stalled criteria.

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-human — needs the deployment, a physical device, and someone watching two dashboards. The remaining criteria are written up step by step in "The runbook for the device session" below, and the bucket-side checks have an instrument (`npm run inspect-r2`) rather than a dashboard that lags. A first device session on 2026-08-11 closed two criteria and produced both runs phase 1.10 [ticket 06](../../phase-1-10-continuous-hls-playback/issues/06-verify-growing-playlist-in-background.md) was waiting for, one of which opened [ticket 11](../../phase-1-10-continuous-hls-playback/issues/11-the-standalone-pwa-is-killed-while-backgrounded.md); see "The device session" below, including what it got wrong.

This is the ticket that turns the phase's central claim from arithmetic into an observation. Everything before it was written against mocked `fetch`; nothing has yet stored a byte in R2 from the app.

## The data is abandoned, not migrated

The Books in the Vercel store are test material. Nothing is copied. That is what let this phase proceed while the Vercel store is locked over quota — there was never a read to perform.

What must be cleaned up is the _index_, not the bytes: the Library index blob and the Redis Chunk index both still describe Books whose audio now lives nowhere reachable. Left alone, the Library lists Books whose playlists resolve to a store the app no longer talks to. Clear both, then re-upload.

The old Vercel store is left intact rather than deleted. It costs nothing, it is the fallback if this cutover goes badly, and its billing cycle resets on 2026-09-06 regardless.

## The measurement

The problem statement in [the spec](../../../specs/phase-1-11-object-storage-migration.md) rests on arithmetic — two writes per Chunk against a 2,000/month allowance — and admits plainly that generation's share of the old quota was never isolated, because the reading that prompted all this was taken before tickets 09 and 10 removed two other spenders. Narrating a Book on a store with nothing else happening on it is the first chance to close that gap.

Take the Class A count before and after narrating a known number of Chunks. The expected answer is two per Chunk. A materially different number means something writes more than this phase believes, and that is worth knowing before it is a surprise.

While in the dashboards, take Upstash's command count over the same window: [ticket 04](04-segment-origin-becomes-configuration.md) claims generation drops from three commands per Chunk to two, and this is the cheapest possible check of it.

## Acceptance criteria

- [x] The deployed app reads and writes R2, with the segment origin, R2 credentials and Redis credentials all set in the deployment environment. _Proven by the writes themselves on 2026-08-10: 42 Chunks stored as audio + metadata pairs, `SEGMENT_ORIGIN` necessarily set because `put` resolves it before writing either object, and the Redis index populated to match._
- [x] The Library index blob and the Redis Chunk index are cleared of the abandoned Books; the Library shows no Book whose audio is unreachable. _Cleared 2026-08-10; both halves turned out to be already empty rather than merely cleared, see "What the clearing actually found". Briefly false again when the 411 below left a half-written Book in the index — re-run after that fix deployed, and the index now names exactly one Book, whose chunks blob and audio both resolve. Note that this says nothing about audio no Book claims: see the orphans in "The first measurements"._
- [x] A Book uploads, narrates, and plays from the new store, on a physical iPhone. _2026-08-11: a 4,962-Chunk Book uploaded, narrated to 55 Chunks, and played from R2 via the Worker. The transcript rendering is also the 411 fix's proof — see "The device session" below._
- [x] **Playback crosses at least two segment boundaries with the app backgrounded**, which is the property phases 1.8 to 1.10 exist for and the one a new serving path could quietly break. _**~30 boundaries, 691s backgrounded, still playing on return** in a Safari tab, and **650s in the standalone PWA** with 30 Chunks generated while hidden. One earlier PWA attempt had its process killed at 101s; it did not reproduce and is parked as phase 1.10 [ticket 11](../../phase-1-10-continuous-hls-playback/issues/11-the-standalone-pwa-is-killed-while-backgrounded.md). All runs in phase 1.10 [ticket 06](../../phase-1-10-continuous-hls-playback/issues/06-verify-growing-playlist-in-background.md)._
- [ ] Seeking to a Sentence inside the currently-playing Chunk works, exercising the Worker's range handling against a real media element rather than against a hand-made request.
- [ ] The resume position survives closing and reopening the Book, and survives on a second device.
- [x] **Measured: Class A operations per generated Chunk**, recorded here with the Chunk count it was measured over. Expected 2. **Measured 2.0, over 20 Chunks** — 40 objects written, counted directly rather than read off the dashboard, which had not caught up. See "The first measurements".
- [ ] **Measured: Upstash commands per generated Chunk**, recorded here. Expected 2 after ticket 04. _**47 commands over 20 Chunks = ≤ 2.35**, an upper bound rather than the figure, because the window carried instrumentation traffic that cannot be separated after the fact. It rules out 3 decisively and is consistent with 2. Left open for one clean run — see "The first measurements" for what that needs._
- [ ] The capacity indicator reports a plausible percentage against 10 GB.
- [ ] Deleting a Book removes its audio from R2, verified by listing the prefix afterwards — this is the path ticket 03's pagination fix exists for.
- [ ] Phase 1.10's [ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) runbook is run against R2, and its two open criteria are closed or their real numbers recorded.
- [ ] Phase 1.10 tickets 04 and 06 are re-triaged now that a live store is available to them.

## Comments

### Run ticket 08's runbook here, adapted

That runbook was written for a cold session on 2026-09-06, when the Vercel allowance reset. Most of it transfers: the instruments change (R2's Class A/B counters instead of Vercel's Simple/Advanced) and step 0 — check the allowance actually reset — is no longer relevant, but steps 3 through 8 are exactly what wants doing here. In particular its step 3, establishing how to tell an index hit from a Blob fallback before measuring either, still matters: the two sources return identical shapes by design, so the only honest instrument is the counters.

The one thing it says that is now wrong: it expects the first request to be slow because the Book in the store predates the Chunk index. Here every Book is new, so the index is populated from the first generation and there is no cold-start fallback to observe.

### The clearing script

`npm run clear-abandoned-library` (`scripts/clear-abandoned-library.mjs`) does the second
criterion's clearing. It is a plain Node script run standalone against whatever R2/Redis
credentials are on the environment, and duplicates the handful of key names and the R2
request-signing `objectStorageClient.js` already defines rather than importing it, for the
same reason `generate-voice-samples.mjs` duplicates `AVAILABLE_VOICES` — Node can't load that
module's ESM syntax standalone. It touches no audio bytes and never the old Vercel store,
which the codebase can no longer even address (ticket 02 replaced that client entirely).

**The two halves are cleared from different sources, which is the part worth knowing.** The
per-Book blobs are enumerated from `library/index.json`, because the index is the only record
of them. Redis is not: it is swept by `SCAN book:*` plus a `DEL library:resume`. Deriving the
Redis half from the index instead — the obvious first shape, and what code review caught —
clears nothing at all at the moment this actually runs. R2's index is empty, because nothing
has ever written a byte there from the app; Redis meanwhile holds every hash the Vercel-era
Books wrote. The loop would find no Books, delete nothing, and print success. Between
`book:*` and `library:resume` the sweep covers every key the app owns.

> **Corrected 2026-08-10 — the second half of that premise is wrong. Redis was empty too.**
> "Redis holds every hash the Vercel-era Books wrote" was never true, and the run below
> measured it: `DBSIZE` is 0. Both Redis features shipped on 2026-08-09 — the Chunk index in
> `9960435`, the resume position in `e5ac705` — and writing either one requires generating a
> Chunk, which requires Blob, which has been over its Simple Operations allowance since
> 2026-08-08. Nothing ever ran. The Vercel-era Books predate all of it; their state lived in
> Blob and in the Library index blob, never in Redis.
>
> **The decision to sweep by pattern still stands, but not for the reason given above.** The
> reason that survives is the weaker and more durable one: the sweep does not have to know
> what is in Redis to clear it, whereas deriving from the index stakes correctness on the two
> sources describing the same set of Books. That assumption happened to be false here in the
> other direction from the one this section imagined, which is the point — an approach that
> never needed it was right either way.

One key the sweep would _not_ have caught: `blob:origin`, written by ticket 08's stage 2 and
removed by [ticket 04](04-segment-origin-becomes-configuration.md), matches neither `book:*`
nor `library:resume`. Confirmed `null` on 2026-08-10, for the same reason as everything else —
writing it required a generation that never happened. Nothing to do, but a future sweep that
runs against a store where generation _did_ occur should not assume the two patterns are still
exhaustive.

Not run as part of this work — it deletes real state, so it waits for whoever runs the actual
cutover, pointed at the real deployment's credentials.

### What the clearing actually found — 2026-08-10

`npm run clear-abandoned-library`, run locally against the deployment's credentials:

```
Library index names 0 Book(s).
Library index reset to [].
Cleared 0 Chunk index key(s) and every stored resume position.
```

Two zeroes, which on the reading this ticket was written with would mean the script had been
pointed at the wrong database. It had not. Checked with the same `--env-file=.env.local`
credentials the script itself loads — deliberately not through the Upstash console, which can
only tell you that _some_ database is empty and not that _the one the script used_ is:

```
database host : precious-tuna-208475.upstash.io
DBSIZE        : 0
blob:origin   : null
SCAN 0 *      : cursor "0", no keys
```

`SCAN` returning to cursor `0` on the first pass with an empty array is a complete sweep of the
keyspace, and agrees with `DBSIZE`. So the store was empty, not unreachable. See the correction
under "The clearing script" for why.

**Two things this leaves for whoever takes the baseline readings.** `Library index reset to []`
is a real `PUT`, so it spends one Class A — take the R2 starting figure _after_ the script, not
before. And the check above spent 3 Upstash commands; take the Upstash starting figure at the
moment narration begins rather than reusing anything read earlier.

**`SEGMENT_ORIGIN` is absent from the local `.env.local`** (the other six are present). It is
not needed by the clearing script, which only does `get`/`put`/`del` on known keys and derives
no segment URLs — but it is needed by anything that generates, and it is the one variable whose
misconfiguration the app cannot detect: [segmentOrigin.js](../../../app/_lib/segmentOrigin.js)
validates presence and the trailing slash, not whether the origin points anywhere real. Confirm
it in the deployment's Production environment before generating, and note that
`vercel env pull` defaults to Development and overwrites rather than merges.

### The first real upload 411'd, and this is the ticket that could find it — 2026-08-10

The first Book ever uploaded to R2 from the app failed, and failed in the exact way this
ticket's opening paragraph anticipated in the abstract: _"Everything before it was written
against mocked `fetch`; nothing has yet stored a byte in R2 from the app."_

**What was observed.** A 3,379-Chunk Book uploaded, the Library listed it, the reader route
opened it, and the transcript was empty with playback dead. `/api/library` had answered 502:

```
Adding the book to the library failed Error: Object storage write failed with 411:
<Error><Code>MissingContentLength</Code><Message>You must provide the Content-Length HTTP
header.</Message></Error>
```

Listing R2 confirmed the split: `library/index.json` existed (6,929 bytes, written at
2026-08-09T17:03:28Z) and `library/<bookId>/chunks.json` did not. `addBook` writes the index
first and the chunks blob second, so the Book was in the Library describing audio and text
that were never stored.

**The cause is that framing was left to the runtime.** `request()` set `content-type` and
`cache-control` and passed the body straight through, relying on whatever sends the request to
supply `Content-Length`. Node's `fetch` does, for a string body of any size — verified locally
at 6,929 B, 100 KB, 1 MB and 2 MB, all with `Content-Length` present and no
`Transfer-Encoding: chunked`. Vercel's did not, for the ~2 MB body. The smaller index blob
written moments earlier on the identical code path went through, which is what made the
failure look size-dependent rather than runtime-dependent.

Neither runtime puts the header on the `Headers` object — `new Request(url, {body})` reports
`content-length` as `null` even when the wire carries it — so nothing in the process could have
noticed the difference.

**This is not reproducible from a development machine, and that is the finding.** A local run
against real R2 with real credentials passes with or without the fix, because Node supplies the
header either way. Only the deployed runtime exhibits it. Four tickets of unit tests against a
mocked `fetch` could not have caught this, and neither could a local integration test.

**The fix** ([objectStorageClient.js](../../../app/_lib/objectStorageClient.js)) encodes a
string body to bytes and sets `content-length` from `byteLength`, so the framing no longer
depends on the runtime at all. Two properties are worth keeping in mind:

- **Counted in bytes, never characters.** The largest object written is a Book's chunks blob,
  mostly CJK at 3 bytes per character; `String.length` would understate it threefold and
  truncate the object. The bytes counted are the bytes sent.
- **Safe to set by hand.** `content-length` is in aws4fetch's `UNSIGNABLE_HEADERS`, so it never
  reaches the signature — read from the installed source rather than assumed, the same way
  ticket 08 settled the client's deserializers.

**Still unverified against the runtime that failed.** The unit tests pin that the header is set
and that the value is a byte count; they cannot pin that Vercel sends it. Redeploy, re-run
`npm run clear-abandoned-library` to drop the half-written Book, and upload again — the
transcript appearing is the proof.

**The failure was silent, which is a separate defect.** Three layers each turned an error into
an absence: the client's `addBook` does not check `response.ok`, `addBook` on the server writes
the index before the chunks blob with no rollback, and `getBook` reads a missing chunks blob as
`?? []`. Opened as [ticket 06](06-a-failed-write-reads-as-an-empty-book.md).

### The first measurements — 2026-08-10

**Generation was driven directly, not by listening.** `POST /api/audio-chunks` for an exact
range of Chunk indexes — the same route the look-ahead calls — so the divisor is chosen rather
than counted. Listening cannot give a clean divisor: `LOOKAHEAD = 10` in
[useBookPlayer.js](../../../app/_lib/useBookPlayer.js) keeps generating ahead of the playback
position and carries on after playback stops, so "narrate about ten Chunks" is a number nobody
knows. The range must also start past anything already stored — an existing Chunk returns as a
cache hit, which still writes the index (Upstash) but writes nothing to R2 (no Class A), and
that pulls the two ratios in opposite directions.

Chunks 100–119 of a 3,379-Chunk Book, on a Book whose Chunks 0–21 had already been generated.

**Class A: 2.0 per Chunk, over 20 Chunks.** The measured range wrote exactly **40 objects** —
20 MP3s and 20 metadata JSONs — which is the `put` pair and nothing else.

The three populations separate cleanly by write time, which is what makes the 20 attributable:

| range                | objects | written                   |
| -------------------- | ------- | ------------------------- |
| Chunks 100–119       | **40**  | 17:40:50Z – 17:42:29Z     |
| Chunks 0–21          | 44      | 17:25:11Z – **17:39:17Z** |
| `demo-book/` orphans | 6       | 06:38Z                    |

The look-ahead's run finished 93 seconds before the measured one began, so nothing overlaps.

**The dashboard counter did not move — 78 before, 78 after — and the objects are the better
instrument anyway.** R2's metrics are an aggregate that lags; the objects carry their own write
timestamps and are a direct count of what the run actually stored. Where the two disagree this
soon after a run, the objects are right. Worth re-reading the dashboard later as a cross-check;
it should settle at 118.

**A hazard this ticket warned about did not occur.** "If the measurement disagrees" below notes
that a Chunk stored but refused an index entry would push Class A per _indexed_ Chunk above 2.
It did not happen: the Book has 42 MP3s and 42 fields in its durations hash, one to one.

**Upstash: 47 commands over 20 Chunks, which is an upper bound of 2.35 rather than a
measurement.** Generation's own cost cannot be separated from the window after the fact — the
counting script alone spends 2 commands per run (`SCAN` + `HLEN`), and the app was reachable
throughout. What the number does settle is the direction: 3 per Chunk would have cost 60, so
[ticket 04](04-segment-origin-becomes-configuration.md)'s claim that dropping the origin `SET`
took generation from 3 commands to 2 holds. Closing this properly needs one run against a
database nothing else is touching: baseline, generate a known range, read again, and run no
counting script inside the window.

**Two of ticket 08's step 8 checks closed in passing.** Both were on its list of things no unit
test could reach:

- _Derived segment URLs actually resolve._ The `url` stored with Chunk 0 is
  `https://leia.text-reader.workers.dev/<bookId>/0/zh-TW-HsiaoChenNeural.mp3`; fetching it gives
  200, `audio/mpeg`, 229,536 bytes matching R2 exactly, `accept-ranges: bytes`,
  `access-control-allow-origin: *`, and a body beginning `FF F3 64` — an MP3 frame sync, so real
  audio rather than an error page. This is what proves `SEGMENT_ORIGIN` names the right host.
- _Durations survive the round trip as numbers._ The playlist body carries `#EXTINF:38.256,`,
  unquoted, for a Chunk whose stored duration is `38.25600000000056`. That is the non-safe-integer
  case `HGETALL` returns as a raw string, so the `Number()` coercion in `toDurationSeconds` is
  doing its job against the real service. The playlist is served as
  `application/vnd.apple.mpegurl`.

**Orphaned audio found: `demo-book/`, 6 MP3s, written 06:38Z.** No such Book is in
`library/index.json`, so the Library cannot see it and `deleteBook`'s cascade will never reach
it — and `clear-abandoned-library` will not either, since that touches only `library/` blobs.
Almost certainly left by `app/dev-preview` or a test run. Harmless at 6 objects, but it is a
ready-made subject for the deletion criterion and for whether
[blobCleanupService.js](../../../app/_lib/blobCleanupService.js) actually sweeps what the index
does not account for.

**Everything requiring the device is still outstanding**, deliberately deferred to a later
session: narration and playback on a physical iPhone, the two backgrounded segment boundaries,
in-Chunk seeking, resume across devices, the capacity indicator, and the deletion check. Note
that the desktop browser cannot stand in for any of them — see the player note in
[ticket 06](06-a-failed-write-reads-as-an-empty-book.md).

### An instrument for the bucket — `npm run inspect-r2`

Everything left on the checklist is checked by looking at what is actually in R2, and the
dashboard is the wrong place to look: it is an aggregate that lags, which is how the first
measurement read 78 Class A before a run and 78 after while the bucket had demonstrably gained
40 objects. [`scripts/inspect-r2.mjs`](../../../scripts/inspect-r2.mjs) lists the bucket and
summarises it by top-level prefix — one group per Book — with each group's byte total and the
window it was written in. It writes nothing.

```bash
npm run inspect-r2                                  # the whole bucket, by prefix
npm run inspect-r2 -- <bookId>/                     # one Book — 0 objects is a clean delete
npm run inspect-r2 -- --since 2026-08-11T09:00:00Z  # what a measured run wrote
npm run inspect-r2 -- library/ --keys                # every key, with size and write time
```

It pages to the end of the listing rather than stopping at S3's 1,000-key cap (a 2,000-Chunk
Book stores nearly 4,000 objects), and refuses a body that is not a listing at all rather than
reporting it as an empty bucket — which is the answer that would otherwise make an HTML error
page look exactly like a successful delete. The summarising half is
[`scripts/r2-summary.mjs`](../../../scripts/r2-summary.mjs) and has tests; the cut-down XML
parse is duplicated from the app for the reason `clear-abandoned-library.mjs` gives, and the
signing that script already had moved to [`scripts/r2-client.mjs`](../../../scripts/r2-client.mjs)
rather than being copied a second time.

**A page of the listing is itself a Class A operation.** Take the baseline with this _before_
reading the dashboard figure, not after.

**The bucket as it stands, 2026-08-11** — one run of the script:

```
Bucket text-reader, prefix: (everything)
92 object(s), 9.62 MB — 0.10% of 10.00 GB
  84ee9c96-c866-43df-bc98-0516b67def77/    84    7.82 MB   17:25:11Z .. 17:42:29Z
  library/                                  2    1.36 MB   17:25:03Z .. 17:25:04Z
  demo-book/                                6  435.02 KB   06:38:33Z .. 06:38:46Z
```

Three things worth reading off it before the device session. The Book's 84 objects are the 42
Chunks of "The first measurements" as an audio+metadata pair each, so nothing has been written
since. `library/` carries the index _and_ a 1.35 MB `chunks.json`, which is the 411 fix
holding in the deployed runtime — the object that never got written before. And the write
timestamps are 2026-08-09, not the 08-10 recorded above; the clock times match exactly, so it
is the dates in this ticket that drifted, not the objects.

### The runbook for the device session

Every remaining criterion, in an order that closes as many as possible in one sitting. The two
measurements are last on purpose: they need a quiet database, and the device work is what makes
it noisy.

**At the laptop, before picking up the phone.**

1. **Confirm the deployment's environment**, Production specifically. `SEGMENT_ORIGIN` is now
   present in the local `.env.local` (it was absent when the section above was written), but
   local presence says nothing about Production, and `vercel env pull` defaults to Development.
   It is the one variable whose misconfiguration the app cannot detect —
   [segmentOrigin.js](../../../app/_lib/segmentOrigin.js) validates presence and the trailing
   slash, never whether the origin points anywhere real.
2. **Take the baseline.** `npm run inspect-r2`, and write down the moment you ran it. Then read
   R2's Class A figure and Upstash's command count, in that order.
3. **Know which Book is which subject.** `demo-book/` is _not_ in the Library index, so
   `deleteBook`'s cascade can never reach it — it is the subject for
   [blobCleanupService.js](../../../app/_lib/blobCleanupService.js), not for the deletion
   criterion. That criterion needs a Book the Library actually lists.

**On the phone.** Safari on a physical iPhone; the desktop cannot stand in for any of this, and
now says so out loud (ticket 06).

4. **Upload a Book and confirm the transcript renders.** That is the 411 fix's real proof: a
   failed chunks write can no longer look like a Book, so an empty reader would now be an error
   screen instead.
5. **Play from the start and let it cross one Chunk boundary in the foreground.** Cheap, and it
   separates "the serving path is broken" from "backgrounding breaks it" before you spend three
   minutes finding out.
6. **The two backgrounded boundaries** — the property phases 1.8 to 1.10 exist for, and the one
   step here that cannot be rushed. **Decide first whether this is the Safari tab or the
   standalone PWA, and do not switch during the run** — they have separate `localStorage`, so
   a log copied from the wrong one is a different log that will look empty. **Do not press
   清除記錄**; entries are timestamped and clearing only destroys the history that makes a
   failure legible. Note the Chunk number, start playback and lock the screen. Segments average
   ~21.6 seconds, so two boundaries is under a minute; give it five and cross a dozen. Unlock,
   and read the log: `visibilitychange hidden` on locking, then
   `visibilitychange visible` and a `reconcile` on return. **`isPlayingCorrectedTo: null` is the
   pass** — it means the element and the UI already agreed and nothing had to be corrected.
   `false` means playback had stopped and the UI had not noticed, which is the original bug.
   Sound stopping at a boundary is the same failure heard rather than read.

   **Read both counters straight afterwards, before doing anything else.** This is also ticket
   08's step 7, its second open criterion: a steady listen must not make the playlist poll cost
   storage reads. Class A should have risen only by twice the number of Chunks that were newly
   generated during the listen, and nothing should have 403'd. A count rising with the polls
   instead means the Chunk index is missing on every one of them.

7. **Seek inside the current Chunk.** Tap a Sentence further down the Chunk that is playing;
   audio should jump there and the highlighting follow. This is the Worker's range handling
   against a real media element — and the highlighting following correctly is ticket 08's last
   step-8 item, since those Sentence spans are now derived at generation time rather than per
   request, so a systematic offset would be new.
8. **Resume, then resume on a second device.** Note the Chunk and Sentence, close the app fully,
   reopen: same place. Then open the same Book on a second device — another iOS device plays it,
   and a desktop browser is still enough to check the _position_, since it will land on the
   right Sentence and then tell you it cannot play the source, which is ticket 06's message
   doing its job.

   **What this actually exercises is Redis, not the snapshot.** `getBook` reads
   `positionClient.read(bookId)` first and only falls back to the `library/<bookId>/resume`
   blob, so a position saved by the ordinary debounced per-Sentence write is what comes back.
   The durable snapshot is a different path: `snapshot: true` is set only by the flush on
   `visibilitychange hidden` and `pagehide` (see
   [useBookPlayer.js](../../../app/_lib/useBookPlayer.js)), and even then it is skipped when the
   debounce has already stored the same pair. Backgrounding before you close is still worth
   doing — it is the flush point — but a pass here does not tell you the snapshot was written,
   and only a Redis outage would.

9. **The capacity indicator.** Home page → 查看用量. At 9.62 MB it will round to **0%**, so the
   percentage on its own cannot be judged plausible or otherwise — read `usedBytes` and
   `quotaBytes` out of `/api/blob-usage` instead and check them against `npm run inspect-r2`'s
   byte total and its `10.00 GB`. Those two agreeing is the criterion; the rendered bar is not.
10. **Delete a Book from the Library**, then `npm run inspect-r2 -- <bookId>/` — expect
    `0 object(s)` — and `npm run inspect-r2 -- library/`, where that Book's `chunks.json` should
    be gone too.

    **This does not exercise ticket 03's pagination**, and pretending otherwise is how that fix
    would go untested. A page holds 1,000 keys; the largest Book in the bucket has 84, and the
    whole bucket has 92. Only a Book past ~500 Chunks would take the cascade over a page
    boundary, and narrating one costs the Class A budget this phase exists to protect. Either
    upload and narrate one deliberately and say so, or record the criterion as closed for the
    cascade and still open for pagination.

**Back at the laptop, for the two measurements.** One window, nothing else touching either
store, and **no counting script inside it** — the counting is what made the last Upstash figure
an upper bound rather than a number.

11. Read Upstash's command count. Note the moment. `POST /api/audio-chunks` for an exact range
    of 20 indexes starting past anything already generated — an existing Chunk returns as a
    cache hit, which still writes the index but writes nothing to R2, and that pulls the two
    ratios in opposite directions. Read Upstash again: **expect 40**, which is the 2/Chunk
    ticket 04 claims.
12. `npm run inspect-r2 -- --since <the moment from step 11>` — **expect exactly 40 objects**,
    20 MP3s and 20 JSONs. Only now re-read the dashboard's Class A figure, as a cross-check on
    a counter that lags rather than as the instrument.

    **Both numbers go in this ticket, next to the Chunk count they were measured over**, which
    is what the two criteria ask for and what the last Upstash figure could not supply.

13. **What is left of phase 1.10 [ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md).**
    Its step 7 is step 6 above and its last step-8 item is step 7 above; two more of step 8
    closed in "The first measurements". That leaves its **step 6**: time one playlist request
    against the largest Book, where the number to beat is 5.4s — and note its own caveat, that
    this measures nothing until that Book's index covers a decent run, because on a cold index
    you are timing the Blob fallback instead. Plus the one item never yet touched: request the
    **manifest** with `?from=` set part-way in, and confirm cues come back rather than an empty
    `sentences` array. That is `HMGET` being keyed by field name, against the real service.
14. **Re-triage phase 1.10 tickets 04 and 06** now that a live store exists to test them
    against.

### The device session — 2026-08-11

The first time this ticket's device half was actually attempted. It closed two criteria,
produced the phase 1.10 evidence that was blocking a whole ticket, and cost one wrong
diagnosis on the way.

**What ran.** A 4,962-Chunk Book uploaded and opened on a physical iPhone. The transcript
rendered, which is the 411 fix holding in the deployed runtime — the `library/<bookId>/
chunks.json` object it used to fail to write is present at 1.6 MB. **Three** listening sessions
followed, and they did not all fail the same way — which is the part worth being careful about:

|                               | 12:00, PWA           | 12:40, Safari tab       | 13:04, PWA                            | 13:28, PWA              |
| ----------------------------- | -------------------- | ----------------------- | ------------------------------------- | ----------------------- |
| backgrounded                  | stopped on lock      | 691s, **still playing** | **101s, then the process was killed** | 650s, **still playing** |
| Sentence highlighting         | stuck, wrong         | correct throughout      | n/a — nothing survived to return to   | not observed            |
| Chunks generated while hidden | **none**             | 31                      | 5, right up to the kill               | 30                      |
| position saved while hidden   | **none** — 0/0 after | per Sentence            | per Sentence, until the kill          | per Sentence            |

The last three columns are phase 1.10 ticket 06's Run A and its two Run B attempts, and they are
the ones with complete instrumentation. **The first column is not explained by any of them**, and
is left open here rather than folded into them: in the 12:00 session the position never left
Chunk 0 and the look-ahead never went past its initial 11 Chunks, whereas both PWA runs advanced
normally. Whatever happened at 12:00, it was not a process reclaimed 101 seconds in. There is no
diagnostic log for it — see "Two instrument lessons" below for why — so it may simply have to be
reproduced before it can be diagnosed.

The full numbers are in phase 1.10 [ticket 06](../../phase-1-10-continuous-hls-playback/issues/06-verify-growing-playlist-in-background.md)
and [the spike log](../../hls-background-spike/spike-log.md); this ticket only needs the
conclusion, which is that **the serving path this phase built is not what fails**. In the run
that was killed, the playlist was being polled on schedule, generation was ahead of the playhead,
and R2 was still being written to seconds before the process stopped existing — and a repeat 21
minutes later, making identical requests, ran 650s without incident. That leaves the kill
unexplained but unreproduced, parked as phase
1.10 [ticket 11](../../phase-1-10-continuous-hls-playback/issues/11-the-standalone-pwa-is-killed-while-backgrounded.md).

**The serving path was checked end to end and is healthy**, which is what made the split
above readable rather than mysterious. Every one of these was measured against the live
deployment rather than reasoned about:

- **Segment durations are exact.** The 11 advertised `#EXTINF` values compared against
  `measureMp3Duration` over the bytes the Worker actually serves: **cumulative drift
  0.000s** across 237.912s. So a desynchronised highlight could not have been the app's
  timeline disagreeing with the element's.
- **The Worker answers ranges properly** — `Range: bytes=0-1023` gives `206` with
  `Content-Range: bytes 0-1023/219744`, not a `200` with the whole object.
- **Cue ordinals line up with the transcript's.** The highlight is addressed by a Book-global
  Sentence ordinal that the manifest and the transcript derive independently; for all 11
  generated Chunks they agree exactly, so the two could not have been counting Sentences
  differently.
- **The diagnostic panel itself works.** Verified on the deployed build by dispatching the
  events and reading the buffer back: `visibilitychange`, `pagehide`, `focus` and `reconcile`
  all persist.

**A wrong diagnosis, recorded because the reasoning was seductive.** Three independent
signals — 11 Chunks generated, `resumeIndex: 0` afterwards, and the look-ahead re-requesting
Chunks 0–10 on reopening — all said the Sentence ordinal had never advanced. Since
`cuechange` is the only thing that advances it, and ADR 0003 explicitly records that the
spike never established that `cuechange` fires, the conclusion looked forced: the mechanism
the ADR flagged as unverified had failed. It had not. The Safari-tab run generated 44 Chunks,
which is impossible unless cues were activating. **The frozen ordinal was a symptom of that
session's playback not running, not the cause of it** — and every one of the three signals is
equally consistent with both, which is exactly why three of them agreeing proved nothing.

**Two instrument lessons for the next run.** The diagnostic log is per storage container, and
a standalone PWA on iOS has its own — so a log copied from the Safari tab after a PWA run is
a different log that will look empty. And 清除記錄 before a run destroys the history that makes
the failure legible; the entries are timestamped, so there is nothing to gain by clearing.

**Still open on the device.** In-Chunk seeking, resume across devices, the capacity
indicator, and the deletion check. The standalone-PWA question has moved out of this ticket
into phase 1.10 [ticket 11](../../phase-1-10-continuous-hls-playback/issues/11-the-standalone-pwa-is-killed-while-backgrounded.md),
which owns both the 13:04 kill and the unexplained 12:00 session.

### If the measurement disagrees

Two writes per Chunk is what `put` does today — the MP3 and its metadata JSON. If the observed number is higher, the likely causes are a retry inside the signing path or a `Content-Type` correction issued as a second write. If it is lower, something is not being persisted, which is worse. Either way the number belongs in this ticket, not in a commit message, because the spec's whole justification points at it.
