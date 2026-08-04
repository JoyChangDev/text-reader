# 01 — Verify edge-tts MP3s work as HLS packed-audio segments

**What to build:** Nothing yet — a narrow measurement that gates the whole phase. Confirm on a physical iPhone whether Safari plays an HLS playlist whose segments are raw edge-tts MP3s served from Vercel Blob, and whether an ID3 PRIV timestamp tag is required for it to work. The answer decides what ticket 02 has to build, and whether the phase proceeds at all.

**Blocked by:** None — can start immediately

**Status:** ready-for-human

HLS permits "packed audio" segments (a raw elementary stream rather than a container), and MP3 is a permitted form, so the `<bookId>/<chunkIndex>/<voice>.mp3` blobs `blobStorageClient.js` already writes could serve as segments with no transcoding. But the specification requires each packed-audio segment to signal its first sample's timestamp via an ID3 PRIV frame with owner identifier `com.apple.streaming.transportStreamTimestamp`, and edge-tts output has no such tag. The spike behind [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) does not answer this — it used ffmpeg-produced fMP4.

Reuse the spike's approach: a static page with one `<audio>`, a hand-written VOD playlist, and enough real generated Chunks to cross several segment boundaries. This does **not** need the heartbeat/background instrumentation — backgrounding is not what's in question here, plain foreground playback across boundaries is.

- [ ] A test playlist is assembled from at least 5 real edge-tts MP3 Chunks (generate them through the existing `/api/audio-chunks` route so they are byte-identical to production output), served from Vercel Blob by absolute URL, and reachable over HTTPS from a physical iPhone.
- [ ] Case A recorded: raw MP3 segments, no ID3 tag. Result is either continuous playback across every boundary, or a specific failure (note whether it fails to load, plays only the first segment, or plays with gaps/artifacts).
- [ ] Case B recorded: the same MP3s with an ID3v2 PRIV frame (`com.apple.streaming.transportStreamTimestamp`) prepended, timestamps running cumulatively across segments. Same observations.
- [ ] Cross-origin fetching is confirmed at the same time: the `<audio>` element carries `crossorigin="anonymous"` and the Vercel Blob responses carry CORS headers permitting it. A CORS failure here must not be misread as a segment-format failure — check the network panel or a desktop browser before concluding.
- [ ] `#EXTINF` values in the test playlist are deliberately set slightly wrong (±0.5s on one segment) in one run, to observe how tolerant playback is of duration error. This calibrates how exact ticket 02's measurement has to be.
- [ ] The outcome is written into the spec's "Segment format" section as a resolved decision (option 1, 2, or 3), replacing the "expected outcome" wording.
- [ ] If neither case A nor case B plays, the phase **stops here** for a re-plan rather than proceeding to the fMP4/ffmpeg branch. Record what was observed and re-triage the remaining tickets to `needs-triage`.

## Comments
