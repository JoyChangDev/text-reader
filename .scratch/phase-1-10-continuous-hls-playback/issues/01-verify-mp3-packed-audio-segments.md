# 01 — Verify edge-tts MP3s work as HLS packed-audio segments

**What to build:** Nothing yet — a narrow measurement that gates the whole phase. Confirm on a physical iPhone whether Safari plays an HLS playlist whose segments are raw edge-tts MP3s served from Vercel Blob, and whether an ID3 PRIV timestamp tag is required for it to work. The answer decides what ticket 02 has to build, and whether the phase proceeds at all.

**Blocked by:** None — can start immediately

**Status:** resolved — raw MP3 works as-is (option 1). See `## Comments`.

HLS permits "packed audio" segments (a raw elementary stream rather than a container), and MP3 is a permitted form, so the `<bookId>/<chunkIndex>/<voice>.mp3` blobs `blobStorageClient.js` already writes could serve as segments with no transcoding. But the specification requires each packed-audio segment to signal its first sample's timestamp via an ID3 PRIV frame with owner identifier `com.apple.streaming.transportStreamTimestamp`, and edge-tts output has no such tag. The spike behind [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) does not answer this — it used ffmpeg-produced fMP4.

Reuse the spike's approach: a static page with one `<audio>`, a hand-written VOD playlist, and enough real generated Chunks to cross several segment boundaries. This does **not** need the heartbeat/background instrumentation — backgrounding is not what's in question here, plain foreground playback across boundaries is.

- [x] A test playlist is assembled from 6 real edge-tts Chunks (~72.5s), generated through `edge-tts-universal` exactly as `edgeTtsClient.js` calls it so the bytes match production, and reachable over HTTPS from a physical iPhone.
- [x] Case A recorded: raw MP3 segments, no ID3 tag. **Played all 6 segments continuously, 72.5s / 72.5s.**
- [x] Case B recorded: the same MP3s with an ID3v2 PRIV frame (`com.apple.streaming.transportStreamTimestamp`) prepended, timestamps running cumulatively. **Also played all 6 segments, 72.7s / 72.5s.** The tag is therefore harmless but unnecessary.
- [x] `#EXTINF` values deliberately skewed (+0.5s on segment 2) in case C. **Played through with no stutter, and `currentTime` ended at 72.5s — the real audio duration, not the 73.0s the playlist declared.**
- [x] The outcome is written into the spec's "Segment format" section as a resolved decision (option 1).
- [x] Neither the stop condition nor the fMP4/ffmpeg branch was reached.
- [ ] ~~Cross-origin fetching confirmed with `crossorigin="anonymous"` and Vercel Blob CORS headers.~~ **Dropped — see `## Comments`.** This control existed to stop a CORS failure being misread as a format failure; case A passed, so there is no failure to misattribute. The real player has no reason to set `crossorigin` at all (cues are added programmatically, so there is no `<track>`), which means it never asks for CORS in the first place. Folded into ticket 04, where real blob URLs get played for the first time.

## Comments

### Result — option 1: raw MP3 works, nothing in the generation path changes

Probe material was on branch `spike/ticket-01-packed-audio` (`public/hls-packed-audio/`, deleted after this record). Tested on a physical iPhone against a Vercel preview deployment.

| Case | Segments                                  | Result                       |
| ---- | ----------------------------------------- | ---------------------------- |
| A    | raw MP3, same-origin                      | played all 6, 72.5s / 72.5s  |
| B    | ID3 PRIV timestamp prepended, same-origin | played all 6, 72.7s / 72.5s  |
| C    | tagged, segment 2's `#EXTINF` +0.5s       | played all 6, ended at 72.5s |

**Case A passing is the whole answer.** The `com.apple.streaming.transportStreamTimestamp` tag the HLS specification requires on packed-audio segments turns out not to be enforced here, so the Chunk MP3s already sitting in blob storage are usable as segments verbatim. No transcoding, no tagging, and no change to `edgeTtsClient.js`, `audioGenerationService.js`, or `blobStorageClient.js`.

**Ticket 02 loses half its scope.** Its ID3 builder is no longer needed — B proved the tag is harmless, but harmless is not a reason to build something. Only the frame-header duration measurement remains.

**Case C says more than "tolerant".** The playlist declared 73.0s in total while the audio was 72.5s, and `currentTime` ended at 72.5s — matching case A exactly. So Safari builds the timeline from the decoded audio rather than by accumulating `#EXTINF`. Two consequences: a small duration error will not accumulate into cue drift over a long Book, and ticket 02's measurement has to agree with what the decoder counts. Summing frame headers does exactly that, since both count the same frames — a further reason to prefer it over any size-and-bitrate estimate.

### Why case A′ (cross-origin) was dropped rather than run

The preview deployment has Vercel Authentication enabled, so `/api/audio-chunks` returns 401 to anything without a browser SSO cookie, and the blob URLs A′ needed could not be generated from a terminal.

That turned out not to matter. A′ existed as a control: if a blob-hosted case had failed, it would have told us whether the cause was CORS or the MP3 format, and without it a CORS failure would have sent the phase into the expensive fMP4 branch for no reason. Case A passed on same origin, so the format question is settled and there is no failure left to attribute.

What remains is a narrower question — whether the media stack can fetch segments from another origin — and the design as specified does not raise it. The probe page set `crossorigin="anonymous"`, which _creates_ a CORS requirement; the real player has no reason to set it, because the metadata track is built with `addTextTrack`/`addCue` rather than a `<track src>`, and nothing reads the audio data. A media element without `crossorigin` fetches segments without asking for CORS at all.

Ticket 04 is where real blob URLs get played for the first time, so the check belongs in its normal dev loop rather than in a separate probe. If it does fail there, the fix is a CORS header on blob responses, not a change of segment format.
