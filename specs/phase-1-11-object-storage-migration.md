# Phase 1.11 — Object Storage Migration

_Status: ready-for-agent_

## Problem Statement

The Listener narrates full-length novels. The largest Book in the store is 1,983 Chunks, and generating a Chunk writes two objects — the MP3 and its metadata. On Vercel Blob's Hobby plan a write is an **Advanced Operation**, of which 2,000 are included per month, so **one novel costs roughly two months of the entire monthly allowance**. Expressed as a rate, the ceiling is about 1,000 new Chunks a month, or 8–11 hours of newly-narrated audio. Re-listening is free; only new narration is charged.

That ceiling is the plan, not the code. The three preceding tickets removed genuine waste — [ticket 08](../.scratch/phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) took the polled playlist from one read per Chunk to zero, [ticket 09](../.scratch/phase-1-10-continuous-hls-playback/issues/09-blob-usage-indicator-costs-an-advanced-operation.md) stopped the capacity indicator spending an operation on every page load, and [ticket 10](../.scratch/phase-1-10-continuous-hls-playback/issues/10-resume-position-spends-an-advanced-operation-per-sentence.md) moved the resume position out of a document rewritten once per Sentence. What is left is not waste: it is the irreducible cost of storing narrated audio.

**One caveat is recorded honestly.** The 1.9k/2k Advanced Operations reading that prompted this was taken _before_ tickets 09 and 10 landed, and both of those were themselves spending Advanced Operations. Generation's own share has therefore never been isolated by measurement. The arithmetic above does not depend on that reading — two writes per Chunk against a 2,000 allowance is arithmetic, not observation — but nobody has yet watched the counter move while a Book was narrated.

The store is also presently locked: it exceeded its Simple Operations allowance on 2026-08-08 and does not recover until the billing cycle on 2026-09-06, which is why several phase 1.10 criteria are unverifiable. Upgrading to Pro would restore access immediately and raise the ceiling to 5,000 Chunks a month for $20 — that option is declined, but recorded below as the standing fallback.

## Solution

Object storage moves to **Cloudflare R2**. Nothing else moves: Redis stays on Upstash, the app stays on Vercel.

- **R2's free tier is not close to binding for this workload**: 1,000,000 Class A operations a month (writes and lists), 10,000,000 Class B (reads), 10 GB-month of storage, and egress that is free and unmetered. A 2,000-Chunk novel costs about 4,000 Class A operations — 0.4% of a month, against 200% of a month today.
- **The bucket stays private.** The app writes to it directly over R2's S3-compatible API. A small Cloudflare Worker, bound to the bucket, is the only public read path; `r2.dev` is not enabled at all.
- **The swap is behind one seam.** The object storage client is the only module that talks to a storage provider, and every consumer already takes it by injection and is tested against a fake, so no consumer changes.
- **Nothing is migrated.** The data currently in the store is test material and is abandoned. Books are re-uploaded into the new environment. This removes the phase's only irreversible step and its only dependency on the locked store, so the work can proceed immediately rather than after 2026-09-06.

## User Stories

1. As a Listener, I want to narrate a full-length novel in one sitting, so that a monthly operations limit doesn't stop me halfway through a Book.
2. As a Listener, I want to narrate several Books in the same month, so that finishing one doesn't mean waiting for a billing cycle to start the next.
3. As a Listener, I want narration to start as quickly as it does today, so that the storage change is invisible from the reading experience.
4. As a Listener, I want segments to keep streaming while the app is backgrounded, so that the new serving path doesn't reintroduce the interruption three phases were spent removing.
5. As a Listener, I want to seek within a Chunk and jump around a Book, so that range requests over the new path behave as they did before.
6. As a Listener, I want my Library, my place in each Book, and my voice and speed settings to behave exactly as before, so that only where the bytes live has changed.
7. As a Listener, I want the capacity indicator to tell me the truth about the new store, so that it doesn't warn me at 10% or stay silent at 90%.
8. As the developer, I want phase 1.10's outstanding live-store criteria checkable now rather than on 2026-09-06, so that tickets 04, 06 and 08 stop being blocked.
9. As the developer, I want to measure what narrating a Book actually costs, so that the arithmetic this phase rests on is replaced by an observation.
10. As the developer, I want the storage swap to leave every consumer's tests untouched, so that the seam the last three tickets relied on is demonstrated rather than assumed.
11. As the developer, I want the code that serves every segment to be reviewable and versioned, so that it cannot drift from the pathname scheme the app derives URLs from.
12. As the developer, I want a documented way back to Vercel, so that a problem with the new path is recoverable without redesign.

## Implementation Decisions

### The read path: a private bucket behind a Worker

The bucket is private. A Worker, bound to it, maps a request path to an object key and streams the body back. It is deployed on a free `*.workers.dev` subdomain, which needs no domain registration and — unlike `r2.dev`, which Cloudflare documents as rate-limited and for development only — is not throttled. A rate-limited segment origin would reproduce exactly the failure ticket 08 spent a week diagnosing.

**The Worker is deliberately dumb**: path to key, stream the body, pass through range and cache headers. It holds no application logic and gets no tests. This is enforced structurally rather than by intention — the repo's vitest configuration runs in jsdom, which is the wrong environment for Worker code, so anything there needing a test is a signal it has grown past a pass-through.

Its source lives in the repo alongside the app, with its `wrangler.toml` committed, because it and the app must agree about the pathname scheme and that agreement should be visible in one diff. Authoring it in the Cloudflare dashboard would leave the code that serves every byte of audio un-diffable and un-reviewable.

### The write path: the app talks to R2 directly

The app writes over R2's S3-compatible API rather than routing writes through the Worker. Sending writes through the Worker would need no S3 credentials in the app, but it would move half the storage seam into a separately-deployed artifact outside the test suite and outside code review — and its failures are silent ones, like a delete that does not delete. The seam is what made the last three tickets safe to attempt; it stays whole and stays tested.

**Signing uses `aws4fetch` rather than the AWS SDK.** The storage client is imported transitively by the playlist route, which the media stack re-fetches continuously during playback, so the SDK's cold-start cost would land on the one path three phases were spent making reliable in the background. The operations actually used — get, put, delete, list — are a small enough surface that the SDK's ergonomics buy little. The cost of this choice is that `ListObjectsV2` returns XML, which means a parser.

That parser is a separate pure module, taking the response body and returning the same `{ pathname, size, uploadedAt }` records the client already produces. The repo has direct precedent: MP3 durations are measured by walking frame headers in a hand-written pure module tested against fixtures, rather than by taking on an audio library.

### The segment origin becomes configuration, superseding a ticket 08 decision

Ticket 08 decided that the store's origin is recovered from a real write response rather than configured, on the grounds that a second environment variable is a second thing to get wrong. **That reasoning held only while writes and reads went to the same host.** Here they do not: writes go to R2's S3 endpoint, reads to the Worker. A write response cannot yield the origin a Listener plays from.

The origin therefore becomes explicit configuration. Two things follow, both simplifications:

- The helper that recovered an origin from a write response disappears. Segment URLs are still derived from the origin plus the cache key, so the derivation itself is unchanged.
- **The Chunk index stops storing an origin at all.** The global origin key, the write that re-set it on every generated Chunk, and the pipelined read that fetched it alongside the durations hash are all removed. Generation drops from three Redis commands per Chunk to two, and the playlist's read becomes a single `HGETALL`.

That also dissolves a hazard rather than mitigating it: there is no stored origin left to go stale at cutover.

### Capacity and cleanup: quota only, behaviour unchanged

The cleanup service's retention rule — delete Chunk audio older than seven days, excluding the Library and pronunciation reports — is **not changed in this phase**. Only the quota constant moves, from 1 GiB to 10 GB, which the module already anticipated with an environment override. Leaving it would make the indicator report against a tenth of the real capacity.

The retention rule deserves revisiting, and gets its own ticket. At 1 GiB the store held about three Books and aggressive expiry was forced; at 10 GB it holds about thirty, and expiring audio for a Book still being read costs the Listener a re-narration for no reason. But that is a product decision about retention, and folding it into an infrastructure move would make any later regression impossible to attribute.

### Naming

Only the storage client module and its factory are renamed, from "blob" — Vercel's product name — to a provider-neutral one. The routes, the cron path, the usage component and the quota environment variable keep their names and get their own ticket. The line is drawn at the file being rewritten anyway: renaming it costs nothing and it would otherwise name a product the system no longer uses, while renaming the routes would touch the cron configuration and the client for no functional gain.

## Testing Decisions

A good test here asserts what the storage client does over the wire and what its consumers see, never how the signing library is called.

- **The client's own tests mock `fetch`, not the signing library.** That is the true boundary: it lets the tests assert the request actually formed — method, URL, headers — and the interpretation of the response. The case that matters most is a missing object: the previous provider resolved null on a 404 while the S3 API returns an error, and the "this Chunk isn't generated yet" branch depends on that becoming `undefined` rather than throwing.
- **The XML parser is its own module, tested against fixture responses**, including a truncated or empty listing. Prior art: the MP3 frame-header parser and its fixture module.
- **No consumer test may need to change.** The Library service, the audio generation service and the cleanup service all inject fakes. This is an acceptance criterion, not an expectation: if any of them needs editing, the seam has leaked and that is a finding.
- The Chunk index's tests lose their origin cases along with the origin, and the segment-URL derivation is tested against a configured base instead of a recovered one.
- The Worker has no tests, by the decision above.

Two things unit tests cannot answer, covered on a physical device in the same shape as phase 1.10's first ticket: whether the Worker serves MP3 segments to Safari's native HLS stack with working CORS and range requests, and whether a full playlist plays across segment boundaries from the new origin.

## Out of Scope

- **Migrating existing data.** It is test material and is abandoned; the Library is cleared and Books are re-uploaded.
- **Changing the retention rule**, and **renaming anything beyond the storage client module** — both have their own tickets, for the reasons above.
- **Moving the app off Vercel.** Next.js on Workers is a far larger question, and `AGENTS.md` warns this Next version differs from what is widely documented.
- **Moving Redis off Upstash.** Cloudflare KV fits neither existing use: its free plan allows 1,000 writes a day, which one Book exceeds during generation, and it has no atomic compare of the kind [ADR 0004](../docs/adr/0004-resume-position-store.md) depends on.
- **Paginating the cleanup service's listing.** Its recorded blocker — that listing was too expensive to do more of — is removed here, since listing is no longer the scarce quota. The fix is its own ticket.
- **Changing the cache key or pathname scheme.** Segment URLs are derived from it and the Worker maps against it.
- **Upgrading to Vercel Pro.** It clears the same ceiling for $20/month with no migration, and a 14-day trial restores access immediately. It is declined, and remains the documented fallback if the serving path proves worse than expected.

## Further Notes

The risk profile of this phase changed substantially once the data was declared disposable. Nothing here can lose anything: there is no copy step, no cutover ordering, and no stale origin to clear. What is left is a client swap behind one tested seam, plus one new deployable that does almost nothing.

The two live risks are both at the edges, and both are cheap to check early. The first is whether request signing works against R2 from the app's runtime — a small, single-maintainer library against a compatibility surface, where the failure is loud and immediate rather than subtle. The second is the Worker's handling of range requests: a media element seeking inside a segment depends on them, the previous provider supplied them without being asked, and a Worker that streams a whole object in response to a range request will look like it works until someone seeks.

The measurement noted in the problem statement should be taken during the first Book narrated on the new store, while the numbers are easy to attribute. It closes the one honest gap in the case for this phase, and it belongs in the same session as phase 1.10's outstanding verification, which this work unblocks.
