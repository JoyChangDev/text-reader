# Phase 1.10 — Continuous HLS Playback

_Status: needs-triage_

## Problem Statement

A Book plays as a queue of short Chunks (`chunkText.js`, `maxChars = 200`) driven by the ping-pong pair of `<audio>` elements in `useBookPlayer.js`: one element plays while the other preloads, and at each Chunk boundary `handleEnded` swaps them and calls `.play()` on the newly active element. Playback does not survive an app switch, and two phases have failed to fix it — Phase 1.8 added MediaSession, a foreground-resync reconciliation checkpoint and a single-active-audio invariant; Phase 1.9 ticket 04 added a stall retry after diagnostics recorded the active element reporting `paused === false` with `currentTime` stuck at exactly 0.

[ADR 0003](../docs/adr/0003-hls-continuous-playback.md) established why, and corrected the assumption those phases were built on. A spike measured 388s of backgrounded playback in a Safari tab (99.8% of wall clock, 12 segment boundaries crossed) and 340s in standalone PWA mode (100.0%, 11 boundaries) from a single `<audio>` element pointed at an HLS playlist. The same spike showed JS was **never frozen** in either run. The failure condition is therefore not "no code runs at the Chunk boundary" but "`.play()` on a freshly-loaded element in the background produces no audio."

That reframing is what this phase acts on: the requirement is not to survive a frozen main thread, it is to never need a second `.play()` after the Listener's initial gesture. It also means ordinary JS work in the background — fetching, appending to a playlist, adding cues — remains reliable, and only the `.play()` call is off-limits.

## Solution

A Book becomes one continuous audio source instead of a queue of files.

- **One `<audio>` element, one `src`, one `.play()`.** The `src` is an EVENT-type `.m3u8` playlist for that (Book, voice), served by a new route. Segments are the Chunk MP3s already in blob storage, listed by absolute URL. The playlist has no `#EXT-X-ENDLIST` until every Chunk is generated, so a Book still starts narrating almost immediately rather than after a whole-Book synthesis.
- **Segment advancement leaves the app entirely.** Nothing in `useBookPlayer` reacts to a Chunk ending, because the media stack moves between segments without asking. The ping-pong pair, `activeIsPrimary`, `enforceSingleActiveAudio`, `handleEnded`'s advance path, and the Phase 1.9 stall retry all go.
- **Sentence highlighting moves to metadata cues.** A `TextTrack` created with `audio.addTextTrack('metadata')` holds one cue per Sentence, keyed by a Book-global Sentence ordinal, with absolute times on the continuous timeline. Highlighting reads `track.activeCues[0].id` in a `cuechange` handler. `findActiveSentenceIndex`, `handleTimeUpdate`, and the `currentSentenceSpans` memo go with it; the browser maintains cue state, so no reconciliation is needed to correct a stale highlight after backgrounding.
- **Absolute times come from the audio itself.** The server measures each Chunk MP3's exact duration by walking its frame headers, so `#EXTINF` values and cue times share one timeline that cannot drift from what is actually playing.

## User Stories

1. As a Listener, I want narration to keep playing while I use another app for several minutes, so that a quick interruption doesn't cost me my place.
2. As a Listener, I want a Book to start narrating within seconds of uploading it, so that continuous playback doesn't come at the cost of waiting for the whole Book to synthesize.
3. As a Listener, I want the highlighted Sentence to match what I'm hearing when I come back to the app, without a visible correction or jump.
4. As a Listener, I want to tap a Sentence further ahead than the narration has reached and have playback continue from there once it's ready.
5. As a Listener, I want my place in a Book to survive across sessions and devices exactly as it does today.

## Implementation Decisions

### Segment format — resolved

edge-tts emits MP3 (`edgeTtsClient.js`), and blob storage already holds one `<bookId>/<chunkIndex>/<voice>.mp3` per Chunk. HLS permits "packed audio" segments — a raw elementary stream rather than a container — and MP3 is one of the permitted forms.

The open question was that the HLS specification requires each packed-audio segment to signal its first sample's timestamp via an ID3 PRIV frame with owner identifier `com.apple.streaming.transportStreamTimestamp`, and edge-tts output carries no such tag.

**Ticket 01 settled it: raw edge-tts MP3s play as HLS segments as-is, untagged.** Six real Chunks played continuously on a physical iPhone, 72.5s of 72.5s, across every segment boundary. A tagged variant played equally well, so the tag is harmless — but it is not needed, and is therefore not built. `edgeTtsClient.js`, `audioGenerationService.js`, and `blobStorageClient.js` need no change at all to produce segments; the fMP4 fallback that would have put ffmpeg in the generation path is not reached.

Ticket 01 also established that Safari derives the timeline from the decoded audio rather than by accumulating `#EXTINF`: a playlist declaring 73.0s for 72.5s of audio still ended at 72.5s, with no stutter at the skewed segment. Duration error therefore does not accumulate into cue drift, but the measurement below must agree with what the decoder counts.

### Measuring Chunk duration

`#EXTINF` values and cue times must agree with the audio to within a fraction of a second across an entire Book, so an approximation is not usable. The last word boundary's `offset + duration` is not the file's duration (it excludes trailing silence), and edge-tts is not guaranteed to emit constant bitrate, so size ÷ bitrate is not reliable either.

A new pure module (e.g. `mp3Frames.js`) walks the MP3's frame headers and sums each frame's duration from its sampling rate and samples-per-frame. It has no dependencies, takes bytes and returns seconds, and is unit-tested against fixture bytes. Counting frames is also what the decoder does, which is what makes it agree with the timeline Safari actually builds — the reason a size-and-bitrate estimate is not an acceptable substitute even though ticket 01 showed half a second of error is survivable.

Duration is measured once, when a Chunk is generated, and stored alongside `boundaries` in the existing `<key>.json` metadata blob. `blobStorageClient.put` already persists an arbitrary object there; this adds a field rather than a blob.

### Playlist and manifest routes

Two new routes, both derived from Chunk metadata already in blob storage:

- **`GET /api/books/[bookId]/playlist.m3u8`** returns the EVENT playlist for a (Book, voice): `#EXT-X-PLAYLIST-TYPE:EVENT`, one `#EXTINF` + absolute blob URL per generated Chunk in order, stopping at the first Chunk not yet generated, and emitting `#EXT-X-ENDLIST` only when the last Chunk is present. Playlist text is produced by a pure builder (e.g. `hlsPlaylist.js`) taking an ordered array of `{ url, durationSeconds }`; the route does storage lookups and nothing else.
- **`GET /api/books/[bookId]/manifest`** returns what the client needs to build cues: per Chunk, its `startSeconds` (the running sum of prior durations) and its Sentences as absolute `{ id, startSeconds, endSeconds }` spans.

`deriveSentenceSpans` moves server-side to produce those spans, offset by the Chunk's `startSeconds`. It keeps its current signature and tests; only its caller changes. Cue `id` is the Book-global Sentence ordinal, so a cue identifies a Sentence without reference to any Chunk.

Generation itself is unchanged: `/api/audio-chunks` still generates one Chunk on demand, and `chunkFetchPlan` still decides which Chunks to request. The look-ahead window rises from 2 so that generation stays comfortably ahead of playback (see the EVENT-playlist risk below).

Segment URLs are absolute Vercel Blob URLs, so the media stack fetches them cross-origin. Blob responses must carry CORS headers permitting that; the first ticket verifies this at the same time as the segment format, since both are answered by one test playback.

### Playback and cues in `useBookPlayer`

One `audioRef`. On mount it is pointed at the playlist URL for the current (Book, voice); `play()` is called once, from the Listener's gesture, and never again for a boundary. Changing voice re-points `src` and is the only thing that legitimately reloads the element. `speed` continues to drive `playbackRate`.

The metadata track is created programmatically — `audio.addTextTrack('metadata')`, `mode = 'hidden'` — rather than declared as a `<track src>`, because a `<track>`'s source is fetched once and a Book's cue set grows as Chunks generate. Cues are added with `track.addCue(new VTTCue(...))` as manifest data arrives, setting `cue.id` to the Sentence ordinal. This is JS running during background playback, which ADR 0003 established is reliable; only `.play()` is not. It also removes the cross-origin `<track>` question the ADR listed as unverified.

`activeSentenceIndex` becomes a Book-global Sentence ordinal derived from `cuechange`. The Library's stored resume position keeps its current `(resumeIndex, resumeSentenceIndex)` shape, mapped to and from that ordinal at the edges, so `bookProgress.js`, `libraryService.js`, and existing persisted positions are untouched — a resume-format migration is not part of this phase.

`currentTimeSeconds` is deleted (written in three places, never read).

### Seeking

`seekToSentence` keeps its two-path shape. When the target Sentence's Chunk is already in the playlist, seeking is `audio.currentTime = cue.startTime` — the one remaining write to `currentTime`, and the only one this phase preserves. When it is not, the existing `pendingSeekRef` behaviour carries over: the highlight moves immediately so the Listener sees what is queued, generation for that Chunk is requested, and the seek is applied once the playlist has grown to include it.

Seeking backwards is unconditionally safe, since every earlier segment is still in the playlist — an improvement over the current player, where it requires a reload.

## Testing Decisions

Unit tests carry the pure parts, which is most of the new surface:

- `mp3Frames.js` against fixture bytes: a known-duration file, a file with an ID3v2 tag already at the head, and a truncated file (returns what it could measure rather than throwing).
- The ID3 timestamp builder: byte-for-byte assertions on the tag it emits, including the owner identifier and the 33-bit timestamp encoding.
- `hlsPlaylist.js`: a partially-generated Book emits no `#EXT-X-ENDLIST` and stops at the first gap; a fully-generated Book emits it; `#EXTINF` values match the durations given.
- `deriveSentenceSpans` with a non-zero `startSeconds` offset, alongside its existing zero-offset cases.
- The manifest route's `startSeconds` accumulation over a Book whose Chunks have unequal durations.

`useBookPlayer` and `AudioPlayer.test.jsx` keep their existing fake-`<audio>` harness, extended with a fake `addTextTrack` returning a stub track that records `addCue` calls and can be driven to fire `cuechange`:

- A `cuechange` naming cue `s-N` sets `activeSentenceIndex` to N, with no `timeupdate` involved.
- Manifest data arriving for a Chunk adds exactly that Chunk's Sentence cues, with absolute times, and adding it twice does not duplicate cues.
- `play()` is called once across an entire simulated Book; no code path calls it at a segment boundary.
- Seeking to a Sentence in a not-yet-generated Chunk moves the highlight, requests generation, and applies `currentTime` only once the playlist covers it.
- Existing coverage that survives — look-ahead fetch planning, Sentence-click seeking within loaded audio, play/pause, resume persistence — passes unchanged.

Tests deleted with their subjects: the ping-pong preload/swap cases, the single-active-audio invariant cases, foreground-resync reconciliation of `activeSentenceIndex`, and the stall-retry cases.

Two things unit tests cannot answer, and that ticket 01 and the final ticket cover on a physical iPhone instead: whether MP3 packed-audio segments play at all, and whether a growing EVENT playlist keeps advancing while backgrounded.

## Out of Scope

- Any change to how text is split into Chunks. `maxChars = 200` stays; Chunk size is now a TTS-request granularity, not a playback granularity, and re-tuning it is a separate question.
- Migrating the stored resume position to a time or a global Sentence ordinal.
- Android and desktop-browser verification. The reported problem is iOS, and Safari is the only browser with native HLS; other browsers are expected to work via the same path but are not tested here.
- In-stream ID3 timed metadata as a replacement for the cue track (rejected in ADR 0003 — the server already knows each Sentence's offset).
- Removing the Phase 1.9 diagnostics panel (`BackgroundDiagnosticsPanel.jsx`). The `logDiagnosticEvent` calls inside `useBookPlayer` go with the code they instrument, but the panel itself is a separate cleanup.
- Any native wrapper. That remains the Phase 2 direction, with its unresolved edge-tts AGPL question.

## Further Notes

The load-bearing risk in this phase is not the one the spike settled. The spike served a **complete VOD** playlist; this phase serves a **growing EVENT** playlist, and when playback reaches the last known segment the media stack must re-fetch the playlist to discover more. Whether it does that reliably while backgrounded is unverified, and if it does not, the failure looks like the current bug — playback stopping at a boundary — just at a coarser granularity.

Two things reduce the exposure. Raising the look-ahead keeps the generated region far enough ahead that playback rarely reaches the end of the playlist. And the corrected mechanism from ADR 0003 means the client can keep fetching and generating in the background, since only `.play()` is unreliable there. Neither is a substitute for measuring it, which is why a background test against a genuinely growing playlist is the phase's final ticket rather than an afterthought — and why ticket 01 gates the phase before any of this is built.
