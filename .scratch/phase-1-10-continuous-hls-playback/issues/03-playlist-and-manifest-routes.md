# 03 — EVENT playlist and Book manifest routes

**What to build:** Two read-only routes derived from Chunk metadata already in blob storage: `GET /api/books/[bookId]/playlist.m3u8`, returning a growing EVENT-type HLS playlist, and `GET /api/books/[bookId]/manifest`, returning the absolute-time Sentence spans the client needs to build metadata cues. Playlist text comes from a pure builder; the routes do storage lookups and nothing else.

**Blocked by:** 02

**Status:** ready-for-agent

Both routes are keyed by (Book, voice) — voice comes in as a query parameter, matching the cache key `audioGenerationService.js` already uses. Neither route generates anything: `/api/audio-chunks` remains the only thing that calls edge-tts, and `chunkFetchPlan` remains the only thing that decides what to generate.

`deriveSentenceSpans` moves server-side here. Its signature and existing tests are unchanged; only its caller and the offset applied to its output are new.

- [ ] A pure builder (e.g. `app/_lib/hlsPlaylist.js`) takes an ordered array of `{ url, durationSeconds }` and returns playlist text: `#EXTM3U`, `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION` (the ceiling of the longest segment), `#EXT-X-PLAYLIST-TYPE:EVENT`, `#EXT-X-MEDIA-SEQUENCE:0`, then one `#EXTINF` + URL per segment.
- [ ] The builder stops at the first not-yet-generated Chunk rather than skipping it — a gap in the middle must not produce a playlist that plays Chunk N followed by Chunk N+2.
- [ ] `#EXT-X-ENDLIST` is emitted only when every Chunk in the Book is present.
- [ ] Unit tests: a fully-generated Book; a partially-generated Book (no `ENDLIST`, truncated at the gap); a Book with a gap in the middle; `#EXTINF` values matching the durations given; `TARGETDURATION` correct for unequal durations.
- [ ] `GET /api/books/[bookId]/playlist.m3u8?voice=…` responds with that text and `Content-Type: application/vnd.apple.mpegurl`, and with cache headers that let the media stack re-fetch it as it grows rather than serving a stale copy (this is what makes an EVENT playlist work at all).
- [ ] Segment entries are absolute Vercel Blob URLs, matching what ticket 01 verified plays cross-origin.
- [ ] `GET /api/books/[bookId]/manifest?voice=…` returns, per Chunk: its index, whether it is generated, its `startSeconds` (the running sum of prior Chunks' `durationSeconds`), and its Sentences as absolute `{ id, startSeconds, endSeconds }` spans.
- [ ] Cue `id` is the Book-global Sentence ordinal (Sentences in all prior Chunks, plus the index within this one) — a cue identifies a Sentence without reference to any Chunk.
- [ ] `deriveSentenceSpans` is called server-side with the Chunk's stored `boundaries`, and its per-Chunk-relative output is offset by `startSeconds`. Its own module and tests are untouched; a test covers the offsetting at the call site.
- [ ] The manifest's `startSeconds` accumulation is unit-tested over a Book whose Chunks have deliberately unequal durations.
- [ ] A Book with no generated Chunks yet returns a valid empty playlist and an empty manifest rather than a 404 or an error.

## Comments
