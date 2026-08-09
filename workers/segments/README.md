# Segment Worker

The only public read path into the private R2 bucket that holds narrated audio. It maps a
request path to an object key, streams the object back, and passes range and cache headers
through. Nothing else.

Opened by
[ticket 01 of phase 1.11](../../.scratch/phase-1-11-object-storage-migration/issues/01-r2-bucket-and-segment-worker.md);
the reasoning for a private bucket behind a Worker is in
[the spec](../../specs/phase-1-11-object-storage-migration.md).

## Deployment

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| Bucket         | `text-reader` (private — `r2.dev` has never been enabled on it)   |
| Binding        | `SEGMENTS`                                                        |
| Worker name    | `leia` (the account's workers.dev subdomain is `text-reader`)     |
| Segment origin | `https://leia.text-reader.workers.dev/` (trailing slash included) |

```bash
cd workers/segments && npx wrangler deploy
```

The origin belongs in this table as well as in the deployment, so a cold session can find what
the app should be configured with without opening the Cloudflare dashboard. The app reads it from
`SEGMENT_ORIGIN` — introduced early by
[ticket 02](../../.scratch/phase-1-11-object-storage-migration/issues/02-object-storage-client-on-aws4fetch.md),
because a write response to the S3 endpoint cannot yield the host a Listener plays from, so the
storage client needed the value in order to return a playable `url` at all.
[Ticket 04](../../.scratch/phase-1-11-object-storage-migration/issues/04-segment-origin-becomes-configuration.md)
takes the Chunk index off its stored origin and onto the same variable.

**Keep the trailing slash.** `deriveSegmentUrl` concatenates — `` `${base}${audioPathname(...)}` ``
in [app/\_lib/chunkIndex.js](../../app/_lib/chunkIndex.js) — and `audioPathname` has no leading
slash, which is why `storeBase` used to slice a Vercel URL down to one ending in `/`. Configured
without it, every segment URL comes out as `…workers.devdemo-book/0/….mp3`. The Worker itself
tolerates either form; the hazard is entirely on the configuration side.

## The pathname scheme

A request path is the object key with a leading slash. The key is `audioPathname` in
[app/\_lib/chunkIndex.js](../../app/_lib/chunkIndex.js):

```
/<bookId>/<chunkIndex>/<voice>.mp3
```

Segment URLs are the origin concatenated with that pathname, so the mapping here is a strip
rather than a translation. This is why the Worker lives in the app's repository: the two must
agree about the scheme, and a change to one should be visible in the same diff as the other.

## What it deliberately does not do

- **No tests**, **no auth**, and no idea what a Book is. The reasoning for each is in the ticket.
- **It does not invent `Content-Type` or `Cache-Control`.** Both come from what the app stored at
  write time, so there is no second place for them to drift. That makes the `audio/mpeg` on an
  `.mp3` response a property of the **write** path, not of this Worker —
  [ticket 02](../../.scratch/phase-1-11-object-storage-migration/issues/02-object-storage-client-on-aws4fetch.md)
  carries the criterion that objects are written with one, and if it regresses, this Worker will
  faithfully serve the wrong type.
- **It only serves `.mp3`** — a deliberate deviation from "no application logic", with its cost
  written up in the ticket.
- **It does not answer 304 for a conditional request.** No criterion asks for one, and doing it
  properly means telling 304 from 412.

It _does_ answer **416** for a range starting past the end of the object. That is not restraint
abandoned: R2 throws there, and an uncaught throw becomes a 500, which on a segment origin reads
as "the Worker is broken" — the most expensive wrong diagnosis available. The 416 is only given
once the object is known to exist, so a genuinely broken store still fails loudly.

## Verifying a deploy

Run these against the deployed origin after placing an object in the bucket. `demo-book/0/…`
is the phase 1.10 probe audio, uploaded by hand — see
[scripts/packed-audio-probe/README.md](../../scripts/packed-audio-probe/README.md).

**Check the range request first.** A Worker that answers a range by streaming the whole object
looks correct in every casual test and fails only when a media element seeks inside a segment,
which is exactly what `seekToSentence` does. Vercel Blob supplied range handling without being
asked, so nothing in the app has ever had to think about it.

```bash
ORIGIN=https://leia.text-reader.workers.dev
KEY=demo-book/0/zh-TW-HsiaoChenNeural.mp3
s() { curl -s -D - -o /dev/null "$@" | grep -iE '^HTTP|^content-(range|length|type)'; }

s -r 0-99          "$ORIGIN/$KEY"   # 206, bytes 0-99/85248, length 100
s -r 1000-1099     "$ORIGIN/$KEY"   # 206, bytes 1000-1099/85248 — seeking inside a segment
s -r -100          "$ORIGIN/$KEY"   # 206, bytes 85148-85247/85248 — suffix range
s                  "$ORIGIN/$KEY"   # 200, audio/mpeg, no Content-Range
s -I               "$ORIGIN/$KEY"   # 200, no body
s -X POST          "$ORIGIN/$KEY"   # 405
s "$ORIGIN/demo-book/999/nope.mp3"  # 404, not 200 with an empty body

# The three R2 resolves to the whole object or throws on — each returned the wrong thing once
s -H 'Range: bytes=abc'        "$ORIGIN/$KEY"   # 200 — an unparseable range is ignored, not 206
s -H 'Range: bytes=0-9,20-29'  "$ORIGIN/$KEY"   # 200 — multi-range likewise
s -H 'Range: bytes=99999999-'  "$ORIGIN/$KEY"   # 416 — not 500

# 204, with Access-Control-Allow-* present
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: Range' "$ORIGIN/$KEY"

# The bytes are the right bytes, not merely a plausible length
curl -s -r 0-99 "$ORIGIN/$KEY" | md5sum
```

On Windows use `curl.exe` — PowerShell aliases `curl` to `Invoke-WebRequest`, which reads `-s` as
`-SessionVariable` — or run the block in Git Bash.

The remaining criteria are the ones curl cannot answer: continuous playback across at least two
segment boundaries on a physical iPhone, and seeking within a single segment during that
playback. Serve the `.m3u8` from the **app's** origin rather than from the bucket — same-origin
playlist and segments would never exercise CORS, which is the arrangement ticket 05 ships.
