# 03 — EVENT playlist and Book manifest routes

**What to build:** Two read-only routes derived from Chunk metadata already in blob storage: `GET /api/books/[bookId]/playlist.m3u8`, returning a growing EVENT-type HLS playlist, and `GET /api/books/[bookId]/manifest`, returning the absolute-time Sentence spans the client needs to build metadata cues. Playlist text comes from a pure builder; the routes do storage lookups and nothing else.

**Blocked by:** 02

**Status:** ready-for-agent

Both routes are keyed by (Book, voice) — voice comes in as a query parameter, matching the cache key `audioGenerationService.js` already uses. Neither route generates anything: `/api/audio-chunks` remains the only thing that calls edge-tts, and `chunkFetchPlan` remains the only thing that decides what to generate.

`deriveSentenceSpans` moves server-side here. Its signature and existing tests are unchanged; only its caller and the offset applied to its output are new.

- [x] A pure builder (e.g. `app/_lib/hlsPlaylist.js`) takes an ordered array of `{ url, durationSeconds }` and returns playlist text: `#EXTM3U`, `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION` (the ceiling of the longest segment), `#EXT-X-PLAYLIST-TYPE:EVENT`, `#EXT-X-MEDIA-SEQUENCE:0`, then one `#EXTINF` + URL per segment.
- [x] The builder stops at the first not-yet-generated Chunk rather than skipping it — a gap in the middle must not produce a playlist that plays Chunk N followed by Chunk N+2.
- [x] `#EXT-X-ENDLIST` is emitted only when every Chunk in the Book is present.
- [x] Unit tests: a fully-generated Book; a partially-generated Book (no `ENDLIST`, truncated at the gap); a Book with a gap in the middle; `#EXTINF` values matching the durations given; `TARGETDURATION` correct for unequal durations.
- [x] `GET /api/books/[bookId]/playlist.m3u8?voice=…` responds with that text and `Content-Type: application/vnd.apple.mpegurl`, and with cache headers that let the media stack re-fetch it as it grows rather than serving a stale copy (this is what makes an EVENT playlist work at all).
- [x] Segment entries are absolute Vercel Blob URLs, matching what ticket 01 verified plays cross-origin.
- [x] `GET /api/books/[bookId]/manifest?voice=…` returns, per Chunk: its index, whether it is generated, its `startSeconds` (the running sum of prior Chunks' `durationSeconds`), and its Sentences as absolute `{ id, startSeconds, endSeconds }` spans.
- [x] Cue `id` is the Book-global Sentence ordinal (Sentences in all prior Chunks, plus the index within this one) — a cue identifies a Sentence without reference to any Chunk.
- [x] `deriveSentenceSpans` is called server-side with the Chunk's stored `boundaries`, and its per-Chunk-relative output is offset by `startSeconds`. Its own module and tests are untouched; a test covers the offsetting at the call site.
- [x] The manifest's `startSeconds` accumulation is unit-tested over a Book whose Chunks have deliberately unequal durations.
- [x] A Book with no generated Chunks yet returns a valid empty playlist and an empty manifest rather than a 404 or an error.

## Comments

### Implementation notes

Decisions the ticket left open:

- **"Generated" means playable, not merely stored.** `isPlayableChunk` (`app/_lib/chunkAudio.js`) is the single rule both routes read: a Chunk cached before ticket 02 has a url and boundaries but no `durationSeconds`, so it can neither carry an `#EXTINF` nor sit at a `startSeconds`. The manifest reports it `isGenerated: false` so the client requests it again — which is what triggers the lazy re-measurement in `audioGenerationService.js`. Reporting it generated would leave the playlist truncated there permanently.
- **A Chunk past a gap is generated but off the timeline.** The playlist stops at the first gap, so a later Chunk with complete audio still has no knowable `startSeconds`; the manifest gives it `isGenerated: true`, `startSeconds: null`, and no Sentence spans.
- **The empty playlist declares `#EXT-X-TARGETDURATION:1`, not `0`.** A client derives its playlist reload interval from the target duration, and a Book serves an empty playlist on exactly the path this ticket requires to work.

The manifest payload is the four fields the ticket enumerates and nothing more. Ticket 04 needs a Chunk's first Book-global Sentence ordinal to map the stored `(resumeIndex, resumeSentenceIndex)` pair; it can take that from `sentenceCountsByChunk`, which `libraryService.js` already persists, or ask for it here when it has a consumer.

Neither route generates or repairs anything: `/api/audio-chunks` remains the only caller of edge-tts.

The manifest is JSON rather than the server-authored WebVTT [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) describes — the phase spec supersedes the ADR there (a Book's cue set grows as Chunks generate, so cues are added with `addTextTrack`/`addCue` rather than fetched once from a `<track src>`), and this ticket serves what that needs. The ADR's load-bearing property is unchanged: the server does the cumulative-offset arithmetic, the client does none.

Verified live against `next dev` that both routes resolve (including the dotted `playlist.m3u8` segment) and reject a missing `voice` with 400; the storage-backed paths return 502 locally only because there are no blob credentials, exactly as the pre-existing `/api/library` route does.
