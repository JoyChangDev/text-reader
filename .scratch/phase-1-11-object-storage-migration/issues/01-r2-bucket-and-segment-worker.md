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

- [x] The bucket exists, is private, and has never had `r2.dev` enabled.
- [x] The Worker is deployed on a `*.workers.dev` subdomain and returns an object placed in the bucket by hand.
- [x] **A range request returns 206 with only the requested bytes**, not 200 with the whole object — see the note below.
- [x] The response carries CORS headers permitting the app's origin, and an `OPTIONS` preflight succeeds.
- [x] `Content-Type` is `audio/mpeg` for an `.mp3` key, so the media element is not left to sniff it.
- [x] A request for a key that does not exist returns 404, not 200 with an empty body.
- [x] **On a physical iPhone**, an `.m3u8` listing several segments served by this Worker plays continuously across at least two segment boundaries.
- [x] Seeking backwards and forwards within a single segment works during that playback.
- [x] `workers/segments/` and its `wrangler.toml` are committed, and the README records the deploy command, the binding name, and the resulting origin.
- [x] `npm run lint` still passes with the new directory present.

## Comments

### The range request is the one that will bite

A Worker that answers a range request by streaming the whole object looks correct in every casual test — the bytes arrive, the audio plays. It fails only when a media element seeks inside a segment, which is exactly what `seekToSentence` does when the target Sentence is inside the Chunk already playing. Vercel Blob supplied range handling without being asked, so nothing in the app has ever had to think about it, and no unit test in this repo covers it.

R2's binding accepts a range option on `get`; the Worker must read the request's `Range` header, pass it through, and answer 206 with `Content-Range`. Check it with a real range request before checking anything else, because every later criterion is easier to satisfy while this one is quietly wrong.

### What this ticket deliberately does not do

It does not point the app at the new origin, migrate anything, or touch the Vercel store. The app keeps working against Vercel Blob throughout — such as it can, given that store is over quota until 2026-09-06. The first thing that reads from R2 in anger is [ticket 05](05-cut-over-and-measure.md).

### Record the origin somewhere the next ticket can find it

[Ticket 04](04-segment-origin-becomes-configuration.md) turns the origin into configuration, and the value comes from here. Put it in the `workers/segments/README.md` as well as in the deployment, so a cold session does not have to open the Cloudflare dashboard to find out what the app should be configured with.

### The range request bit three times, and none of the three looked like a failure

The ticket predicted the shape of this and still understated it. Every one of these returned
something that a listen test would have accepted.

**Round one, found by `curl`.** The first deploy answered `bytes=0-99` with the right hundred
bytes under `Content-Range: bytes NaN-NaN/85248`. Nothing truncated, nothing over-sent. Two
mistakes about R2's `R2Range`, both invisible without reading headers:

- **It carries every field**, so `'suffix' in range` is true even for an offset/length range: the
  suffix branch ran for an ordinary request and computed `size - undefined`.
- **It is populated even when no range was asked for**, resolved to the whole object, so it cannot
  answer "is this partial" — only the request's own `Range` header can. A plain `GET` was
  returning `206` over the entire file.

**Round two, found while checking a code-review claim** that the surviving `!object.range` clause
was dead. It was not dead for the reason given, and probing it turned up worse:

| `Range` sent      | answered                      | should be                                         |
| ----------------- | ----------------------------- | ------------------------------------------------- |
| `bytes=abc`       | `206` + `bytes 0-85247/85248` | `200` — RFC 9110 says ignore an unparseable range |
| `bytes=0-9,20-29` | `206` + whole file            | `200`                                             |
| `bytes=99999999-` | **`500`**                     | `416`                                             |

R2 resolves a header it cannot parse to the whole object rather than rejecting it, so "resolved a
range" and "was asked for a range" are still not the same question — the honest test is whether
the resolved length is shorter than the object. And a range starting past the end makes R2 _throw_,
which without a catch becomes a 500 on the segment origin: the most expensive wrong diagnosis
available, since it reads as "the Worker is broken" rather than "the client asked for nonsense".

None of these three arise from Safari, which sends well-formed single ranges. That is exactly why
they survived a physical-device test that passed on the first try.

### What verified what

- Range behaviour, over `curl`: closed (`0-99`), mid-file (`1000-1099`), suffix (`-100`) and
  open-ended (`85148-`) return 206 with a correct `Content-Range`; a plain GET returns 200 with no
  `Content-Range`; `HEAD` returns 200 with no body; malformed, multi-range and out-of-bounds behave
  as the table above says they should. The first hundred bytes hash equal to the local `seg-0.mp3`,
  so this is the right bytes and not merely a plausible length.
- CORS, in a real browser rather than by header inspection: a cross-origin `fetch` carrying a
  `Range` header (a preflighted request) returned 206, and JS could read `Content-Range` — which
  only works because `Access-Control-Expose-Headers` lists it. `curl` cannot test this; it does not
  enforce the same-origin policy.
- Privacy, via `wrangler r2 bucket dev-url get`: "Public access via the r2.dev URL is disabled."
  That the URL was _never_ enabled rests on the account's history rather than on this observation.
- The physical iPhone, on the Vercel preview, with the playlist served from the app's origin and
  the segments from the Worker — deliberately cross-origin, because a playlist served from the
  bucket alongside its segments would never exercise CORS at all. Media events recorded:
  `duration 72.50s` (equal to the six `#EXTINF` values summed), then `playing` at 0.00s and `ended`
  at 72.52s with **no `waiting` and no `stalled` in between** — five boundaries crossed, not the
  two required. Seeking within the first segment ran 6.24 → 4.64 → 5.15 → 5.66 → 6.24 → … → 2.47s,
  every `seeking` matched by a `seeked`, with `playing` resuming after.

### Two rules here are not in this ticket

**The Worker serves only `.mp3`.** The bucket also holds `library/<bookId>/chunks.json` — the full
text of an uploaded Book — and this Worker is the entire boundary between a private bucket and the
open internet, so whatever it will serve is public. Nothing reads Library JSON over this path; that
goes over the authenticated S3 API. Without the rule, the only thing protecting a Book's text is
that its `bookId` is an unguessable UUID. Its cost: a future non-`.mp3` read over this origin — an
fMP4 or AAC segment, say — would 404, and 404 already means "this Chunk isn't generated yet", so
the mistake would wear another mistake's clothes.

**It answers 416**, which the README first recorded as something it deliberately would not do. That
was written believing an unsatisfiable range would degrade quietly; it 500s instead. The 416 is
only given once the object is known to exist, so a genuinely broken store still fails loudly.

Both are deviations from "no application logic". Recorded so a later reader can weigh them rather
than discover them.

### The recorded origin carries a trailing slash on purpose

`deriveSegmentUrl` concatenates — `` `${base}${audioPathname(...)}` `` — and `audioPathname` has no
leading slash, which is why `storeBase` sliced a Vercel URL down to one ending in `/`. Ticket 04 is
told to take the origin from the README, so the README records
`https://leia.text-reader.workers.dev/` with the slash. Without it every segment URL comes out as
`…workers.devdemo-book/0/….mp3`. The Worker tolerates either form; the hazard is entirely on the
configuration side, which is where the value is about to go.

### `audio/mpeg` is a property of the write path, not of this Worker

The criterion "`Content-Type` is `audio/mpeg` for an `.mp3` key" passes here because the probe
object was uploaded with `--content-type=audio/mpeg` and the Worker echoes stored metadata rather
than inventing it. The guarantee therefore lives in [ticket 02](02-object-storage-client-on-aws4fetch.md),
whose own criterion is that objects are written with a `Content-Type`. If that regresses, this
Worker will faithfully serve the wrong type and this ticket's tick will still be honest.
