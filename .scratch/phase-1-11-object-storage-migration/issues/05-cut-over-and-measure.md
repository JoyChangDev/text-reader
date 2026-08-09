# 05 — Cut over, and measure what a Book actually costs

**What to build:** Point the deployed app at R2, clear the Library of abandoned test data, narrate a Book end to end, and record what it cost. Then unblock phase 1.10's stalled criteria.

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-human — needs the deployment, a physical device, and someone watching two dashboards.

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

- [ ] The deployed app reads and writes R2, with the segment origin, R2 credentials and Redis credentials all set in the deployment environment.
- [ ] The Library index blob and the Redis Chunk index are cleared of the abandoned Books; the Library shows no Book whose audio is unreachable. _The clearing itself ran clean on 2026-08-10 — both halves turned out to be already empty rather than merely cleared, see "What the clearing actually found". Un-ticked because the failed upload below then put a Book back into the index with no chunks blob behind it, which is precisely the state this criterion forbids. Re-run the script after deploying the Content-Length fix._
- [ ] A Book uploads, narrates, and plays from the new store, on a physical iPhone.
- [ ] **Playback crosses at least two segment boundaries with the app backgrounded**, which is the property phases 1.8 to 1.10 exist for and the one a new serving path could quietly break.
- [ ] Seeking to a Sentence inside the currently-playing Chunk works, exercising the Worker's range handling against a real media element rather than against a hand-made request.
- [ ] The resume position survives closing and reopening the Book, and survives on a second device.
- [ ] **Measured: Class A operations per generated Chunk**, recorded here with the Chunk count it was measured over. Expected 2.
- [ ] **Measured: Upstash commands per generated Chunk**, recorded here. Expected 2 after ticket 04.
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

### If the measurement disagrees

Two writes per Chunk is what `put` does today — the MP3 and its metadata JSON. If the observed number is higher, the likely causes are a retry inside the signing path or a `Content-Type` correction issued as a second write. If it is lower, something is not being persisted, which is worse. Either way the number belongs in this ticket, not in a commit message, because the spec's whole justification points at it.
