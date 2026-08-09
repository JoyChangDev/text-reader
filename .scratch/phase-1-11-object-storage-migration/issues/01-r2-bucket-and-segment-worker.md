# 01 — Provision the R2 bucket and the segment Worker

**What to build:** A private R2 bucket, and a Worker bound to it that serves segments on a free `*.workers.dev` subdomain. Verified on a physical device before anything else in this phase is built against it.

**Blocked by:** —

**Status:** ready-for-human — creating the Cloudflare account and the bucket cannot be automated, and the verification is a physical-device check.

Gates the whole phase, because it produces the one value everything else is configured with: the origin segments are played from. See [the spec](../../../specs/phase-1-11-object-storage-migration.md).

## What to set up

**A private bucket.** `r2.dev` is not enabled on it at any point. Cloudflare documents that endpoint as rate-limited and for development only, and a rate-limited segment origin reproduces exactly the failure [ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) spent a week diagnosing — public reads 403ing while the authenticated API kept working.

**A Worker bound to the bucket**, living at `workers/segments/` in this repo with its `wrangler.toml` committed, deployed with `wrangler`. Its source belongs here rather than in the Cloudflare dashboard because it and the app must agree about the pathname scheme, and that agreement should be visible in one diff.

**The Worker stays dumb**: map the request path to an object key, return the object's body, pass range and cache headers through. No application logic, no auth, no tests. That last point is structural rather than aspirational — `vitest.config.js` runs everything in jsdom, which is the wrong environment for Worker code, so a Worker that needs a test is a Worker that has grown past a pass-through.

**Two R2 API tokens.** The app needs S3 credentials for writes ([ticket 02](02-object-storage-client-on-aws4fetch.md)); the Worker needs only its binding. Do not give the app's token more than it needs.

## Acceptance criteria

- [ ] The bucket exists, is private, and has never had `r2.dev` enabled.
- [ ] The Worker is deployed on a `*.workers.dev` subdomain and returns an object placed in the bucket by hand.
- [ ] **A range request returns 206 with only the requested bytes**, not 200 with the whole object — see the note below.
- [ ] The response carries CORS headers permitting the app's origin, and an `OPTIONS` preflight succeeds.
- [ ] `Content-Type` is `audio/mpeg` for an `.mp3` key, so the media element is not left to sniff it.
- [ ] A request for a key that does not exist returns 404, not 200 with an empty body.
- [ ] **On a physical iPhone**, an `.m3u8` listing several segments served by this Worker plays continuously across at least two segment boundaries.
- [ ] Seeking backwards and forwards within a single segment works during that playback.
- [ ] `workers/segments/` and its `wrangler.toml` are committed, and the README records the deploy command, the binding name, and the resulting origin.
- [ ] `npm run lint` still passes with the new directory present.

## Comments

### The range request is the one that will bite

A Worker that answers a range request by streaming the whole object looks correct in every casual test — the bytes arrive, the audio plays. It fails only when a media element seeks inside a segment, which is exactly what `seekToSentence` does when the target Sentence is inside the Chunk already playing. Vercel Blob supplied range handling without being asked, so nothing in the app has ever had to think about it, and no unit test in this repo covers it.

R2's binding accepts a range option on `get`; the Worker must read the request's `Range` header, pass it through, and answer 206 with `Content-Range`. Check it with a real range request before checking anything else, because every later criterion is easier to satisfy while this one is quietly wrong.

### What this ticket deliberately does not do

It does not point the app at the new origin, migrate anything, or touch the Vercel store. The app keeps working against Vercel Blob throughout — such as it can, given that store is over quota until 2026-09-06. The first thing that reads from R2 in anger is [ticket 05](05-cut-over-and-measure.md).

### Record the origin somewhere the next ticket can find it

[Ticket 04](04-segment-origin-becomes-configuration.md) turns the origin into configuration, and the value comes from here. Put it in the `workers/segments/README.md` as well as in the deployment, so a cold session does not have to open the Cloudflare dashboard to find out what the app should be configured with.
