# 02 — Rewrite the storage client on R2, signing with aws4fetch

**What to build:** `objectStorageClient.js` — the same eight-method contract `blobStorageClient.js` exposes today, talking to R2's S3-compatible API over `aws4fetch` instead of `@vercel/blob`. `list()` is deferred to [ticket 03](03-list-objects-xml-parser.md).

**Blocked by:** —

**Status:** resolved — 2026-08-16. The criterion below was reviewed against the actual diff and accepted; the reasoning is in "The two changes, reviewed" at the bottom. One of the two files was genuinely reaching past the seam, which is the finding this criterion exists to produce, and the coupling its fix introduced is now commented at the seam it depends on.

Not blocked by [ticket 01](01-r2-bucket-and-segment-worker.md): the tests mock `fetch`, so the whole of this ticket can be written and verified before a bucket exists. It cannot be _run_ against R2 until 01 lands, which is what [ticket 05](05-cut-over-and-measure.md) is for.

## Why aws4fetch rather than the AWS SDK

The storage client is imported transitively by the playlist route — `bookAudio` → `audioGenerationService` → the client — because the Blob scan is still the Chunk index's fallback. That route is re-fetched continuously by the media stack during playback, including while backgrounded. `@aws-sdk/client-s3` is megabytes and a few hundred milliseconds of cold start; putting that on the one path phases 1.8 through 1.10 were spent making reliable in the background is the wrong trade for a client that only ever does get, put, delete and list.

`aws4fetch` is about a kilobyte and signs plain `fetch` requests. Its cost is that `ListObjectsV2` comes back as XML — see ticket 03, and the precedent in `mp3Frames.js`, which walks MP3 frame headers by hand rather than taking on an audio library.

## The contract that must not change

Every consumer injects this client and is tested against a fake, so the whole point is that none of them notices. Keep the method names, arguments and return shapes exactly as they are, including the two conventions that are the client's own and invisible to callers: the `.json`/`.mp3` suffixing, and the fact that `del`/`list` take literal pathnames while `get`/`put` take cache keys.

**The one behaviour that does not port for free is a missing object.** `@vercel/blob`'s `get()` resolves `null` on a 404; the S3 API returns a 404 response that most clients surface as an error. `readCachedChunks`' "this Chunk isn't generated yet" branch, `libraryService`'s empty-index path and `getBook`'s snapshot fallback all depend on absence being `undefined` rather than a throw.

## Acceptance criteria

- [x] `objectStorageClient.js` exports `createObjectStorageClient` with the same ~~eight~~ **six** methods, arguments and return shapes as today's client. (`get`, `put`, `getAudioBytes`, `putJson`, `del`, `list` — the ticket's "eight" was a miscount.)
- [x] Credentials and the bucket/endpoint come from environment variables; nothing is hardcoded, and an absent configuration fails loudly at the seam rather than silently returning empty results.
- [x] **A missing object resolves to `undefined` from `get` and `getAudioBytes`**, never throws.
- [x] A non-404 error (403, 500, a network failure) still throws, so a broken store is not mistaken for an empty one.
- [x] `put` returns the same `{ url, boundaries, durationSeconds }` shape, with `url` being the **playable** segment URL rather than the S3 endpoint — see the note below.
- [x] Objects are written with a `Content-Type` (`audio/mpeg`, `application/json`), so the Worker can serve them without sniffing.
- [x] `del` accepts the literal pathname form the existing callers pass, unchanged.
- [x] **The client's tests mock `fetch`, not `aws4fetch`** — they assert the request that was actually formed (method, URL, signed headers) and how the response was interpreted.
- [x] **No consumer test file changes.** `libraryService.test.js` and `blobCleanupService.test.js` pass untouched; `audioGenerationService.test.js` and `progressiveGeneration.test.js` did not. See "Two consumer tests changed" below, and "The two changes, reviewed" for why both edits were accepted rather than treated as a failure.
- [x] `@vercel/blob` is removed from `package.json` and imported nowhere.
- [x] The full suite (511 tests, 52 files) and `npm run lint` pass. `npm run format:check` does **not**, and did not before this work either — see "format:check was already failing" below.

## Comments

### The `url` in a put response is not the S3 URL

Today `put` returns the URL the write went to, and that URL is also the one a Listener plays from, because Vercel Blob reads and writes on the same host. On R2 they are different hosts: writes go to the S3 endpoint, reads to the Worker. Returning the S3 URL would put an unplayable address into `library/<book>/<chunk>/<voice>.json` and, through it, into anything that trusts stored metadata.

This is the same fact that makes [ticket 04](04-segment-origin-becomes-configuration.md) necessary. Until that lands, the simplest correct thing here is to build the returned `url` from the configured segment origin rather than from the request that was signed. If ticket 04 lands first, take the origin from wherever it put it.

### No consumer test may change — treat a failure here as a finding

This criterion is the whole argument for the seam, and it is worth being strict about. Tickets 08 and 10 both moved substantial machinery — a Redis index, a resume-position store — without touching a consumer test, because storage access was already behind one injected client. If swapping the provider underneath it does require editing `libraryService.test.js`, then something has been reaching past the seam and that is worth finding out now rather than absorbing quietly.

### Two consumer tests changed, for two different reasons

Reported rather than absorbed, as asked. The seam held where the ticket predicted, and leaked
where it did not think to look.

**`libraryService.test.js`, `blobCleanupService.test.js` and `pronunciationReportService.test.js`
are untouched and pass.** All three build a plain object literal and pass it in, so the provider
swap is genuinely invisible to them. That is the criterion's actual claim, and it holds.

**`audioGenerationService.test.js` changed by two lines**, and this is not a leak. It substitutes
its fake with `vi.mock('./blobStorageClient', …)` rather than by injection, because
`generateAudioForChunk` reads `defaultClients` from module scope and there is nothing to inject
into. A module mock names the module, so the rename the spec mandates — "only the storage client
module and its factory are renamed" — necessarily moves it. The two decisions are in direct
conflict, and this criterion cannot be met while the other is honoured. Nothing about the
_contract_ changed: the fake's methods, arguments and return shapes are as they were.

**`progressiveGeneration.test.js` was reaching past the seam**, which is the finding. It mocked
`@vercel/blob` directly — the vendor package, not the client — so removing the dependency left it
mocking nothing. It is now faked at `fetch` instead, which is strictly better than restoring the
old arrangement: the file's stated purpose is to fake external dependencies "at the lowest level"
so everything above them is real, and with the client signing its own requests, `fetch` _is_ that
level. The real client — suffixing, signing, 404-means-absent, the segment URL — is now inside
what those five end-to-end tests cover, where before it was replaced wholesale.

The narrow lesson: a seam is only as good as the way tests reach it. Two of the four consumers
inject, and were free. The two that mock by module path both had to move.

### aws4fetch's defaults are wrong for this app in two ways, both silent

Neither was predictable from the docs; both surfaced only because the tests assert over `fetch`.

**It retries a 5xx or a 429 ten times**, backing off exponentially from 50ms — up to roughly half
a minute of a request held open. On the playlist route the media stack re-polls during playback,
a request that fails slowly is worse than one that fails: the route has a fallback and phases
1.8–1.10 were spent on not stalling there. Set to two retries, and pinned by a test, because it
is a default that will otherwise be silently re-inherited.

**A `Request` body it does not recognise becomes the nine bytes `"undefined"`.** `put` is handed
a `Blob` from edge-tts, and undici's `Request` accepts Node's `Blob` but stringifies a foreign one
— which is exactly what jsdom hands it under test. An upload that succeeds, stores nine bytes and
plays as nothing. Production would not have hit it (the server runtime's `Blob` is Node's), but
the failure mode is bad enough that the client now reads the Blob to bytes before writing, which
costs nothing: it is already wholly in memory and `audioGenerationService` has already read the
same bytes to measure the duration.

### `list()` throws rather than returning `[]`

Deferred to ticket 03 as instructed, but the stub is not inert. `getUsage` would report an empty
store and `deleteBook`'s cascade would silently orphan every audio object under a Book — with
nothing left to notice, since the Book is already out of the index. Between this ticket and 03,
the capacity indicator and the cleanup cron therefore fail loudly. That is the intended state;
ticket 05 is the first thing that runs against a real bucket.

### `SEGMENT_ORIGIN` landed here rather than in ticket 04

As the note above allows: `put` cannot return a playable `url` without it. Ticket 04 inherits the
variable rather than introducing it, and still owns taking the Chunk index off its stored origin.
`workers/segments/README.md` has been updated to say so, and the README now documents the whole
environment — the five R2 settings, the two Redis ones and `BLOB_QUOTA_BYTES` — which nothing in
the repo recorded before.

### What code review changed

Two axes, both run against the finished diff. Five findings were real and are fixed; the rest
are recorded here as deliberate.

**Fixed — a fresh `AwsClient` per request.** It was constructed inside the request helper, so
aws4fetch's cache of derived signing keys (four chained HMACs from secret to date/region/service
key) started empty every time and was thrown away. `readCachedChunks` fires sixteen parallel
`get`s per batch on the playlist route — the exact path the retry tuning above exists to protect,
and the reason the file's header gives for not taking the AWS SDK. Now held in the closure and
keyed by the credentials, so a rotated key still gets a new signer.

**Fixed — a 404 was read as "absent" whatever it meant.** S3 answers 404 for `NoSuchBucket` as
well as `NoSuchKey`, so a typo in `R2_BUCKET` or `R2_ACCOUNT_ID` would have made every read
resolve `undefined`: a Library with no Books, every Book with no audio, and generation
cheerfully rewriting the lot into a bucket that does not exist. Exactly the failure the criterion
"so a broken store is not mistaken for an empty one" names, arriving through the one status code
the criterion told us to treat as benign. The XML body distinguishes them and is now read.

**Fixed — the trailing-slash normaliser was creating the divergence it claimed to prevent.** It
repaired a slashless `SEGMENT_ORIGIN` here only; `deriveSegmentUrl` concatenates raw, and ticket
04 points it at this same variable, so a slashless origin would have given playable URLs from
`put` and broken ones from the Chunk index. Now rejected with a message naming the variable,
which also makes both READMEs' "keep the trailing slash" true rather than advisory.

**Fixed — two comments stated things that were not so.** The `put` comment repeated this
ticket's own `library/<book>/<chunk>/<voice>.json`, but Chunk metadata is `<bookId>/<chunkIndex>/
<voice>.json` at the bucket root; `library/` holds the index, the chunks and the resume
snapshots. And the `list()` comment claimed throwing saves `deleteBook`'s cascade from silently
orphaning audio — it does not, because the `list()` call is the last step, after the index has
already been rewritten. The audio is orphaned either way; what the throw buys is that the
capacity indicator and the cleanup cron cannot report a clean, empty store.

**Flagged, per `docs/agents/domain.md`'s "flag ADR conflicts" rule.** ADR 0004 names Vercel Blob
as the resume snapshot's store. A dated note has been appended saying the store changed and the
decision did not — the ADR's reasoning turned on Redis having an atomic compare and the snapshot
being second-best, neither of which is a property of the provider. The text above it is left
alone: the provider named in a decision's reasoning is part of the record of why it was made.
`CONTEXT.md`'s two Vercel Blob references are corrected, since it describes what is true now.

**Left deliberately.** The README's environment section documents the Redis variables and
`BLOB_QUOTA_BYTES` alongside the five this ticket introduces, which reaches into ticket 04's
"documented in the README" criterion — but nothing in the repo recorded any of them before, and
a section that documents three-fifths of an environment is worse than one that documents it.
Ticket 04 inherits it already satisfied. The stale comments in `chunkIndex.js` (`addRandomSuffix`,
`BLOB_READ_WRITE_TOKEN`), `redisChunkIndex.js` (`ORIGIN_KEY`) and `blobCleanupService.js` (Vercel's
1 GiB) are all on lines ticket 04's "What this removes" deletes outright, so they are left for it.

### format:check was already failing

The criterion cannot be met by this ticket. `npm run format:check` reports 95 files at `HEAD`,
including `README.md`, `vitest.config.js` and other files untouched here: the working copy is
checked out with CRLF line endings and Prettier defaults to `endOfLine: "lf"`. Every file this
ticket touched was already in that failing set, and `pronunciationReportService.js`, `CONTEXT.md`,
`RESOURCES.md` and `workers/segments/README.md` came _out_ of it. Fixing the cause means either a
repo-wide re-write of ~95 files or a `.gitattributes`/Prettier setting, which is its own change
and does not belong in a storage migration.

### The two changes, reviewed

Reviewed against the diff on 2026-08-16 and accepted. The criterion asked that a failure here be
treated as a finding rather than absorbed; it was reported, and this is the verdict on it. The two
files failed the criterion for reasons of completely different weight, and only the second is
actually interesting.

**`audioGenerationService.test.js` is two lines and is not a judgement call.** The whole edit is
`vi.mock('./blobStorageClient')` → `vi.mock('./objectStorageClient')`. A module-path mock has to
name the module, and the spec mandates renaming that module, so the two rules are in direct
conflict and one of them has to give. Nothing about the contract moved.

**`progressiveGeneration.test.js` is the finding, and the fix is better than the arrangement it
replaced.** It mocked `@vercel/blob` — the vendor package, not the injected client — so it had been
reaching past the seam since before this phase, invisibly, and removing the dependency is only what
made that visible. Faking `fetch` instead puts the real client's signing, `.json`/`.mp3` suffixing,
404-means-absent mapping and segment-URL construction inside what those five end-to-end tests cover,
where previously all of it was replaced wholesale. That is what the file's own header says it is for.

**The cost, now commented rather than only known.** `objectKey()` recovers the object key by slicing
the bucket off the URL's pathname, which silently assumes path-style addressing. Moving the client to
virtual-hosted style would break every test in the file with a key of `undefined` — a failure naming
nothing. A comment at `objectKey()` now says so, because the coupling is a consequence of faking one
layer lower and the next person to touch the client's URL construction is the one who needs to know.

**What faking at `fetch` does not buy.** The `411 MissingContentLength` fixed in `b78ef6d` went
straight through this fake, whose `PUT` branch answers `200` without reading a header. Real S3
rejects that request; the fake does not model it, and the regression test for it correctly lives in
`objectStorageClient.test.js` instead. The lower fake widens what these tests cover — it does not make
them a substitute for the client's own, and it was never going to catch a bug about a header the fake
does not inspect.
