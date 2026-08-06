# 07 — Seeking past the generated region, by starting the playlist there

**What to build:** Give the playlist and manifest routes a start Chunk, so a Sentence click that lands beyond what the playlist can reach re-points the element at a playlist beginning at that Chunk instead of parking a seek that can never be applied.

**Blocked by:** 05

**Status:** ready-for-human

Ticket 05 rebuilt seeking around cue times and left one case unreachable. A playlist truncates at its first gap ([hlsPlaylist.js](../../../app/_lib/hlsPlaylist.js)) and the manifest follows it, so a Chunk past an ungenerated one has no `startSeconds` and gets no cues. `seekToSentence` generates only the target — a phase-1.5 rule, correct when each Chunk was its own audio file — so on a 20-Chunk Book, opening it generates 0–10, clicking into Chunk 15 generates 15 alone, and Chunks 11–14 are never requested by anything. The playlist stays 11 segments long, the parked seek waits forever, and playback stops at the end of Chunk 10 with the highlight sitting on a Sentence that never plays.

The fix keeps the phase-1.5 rule rather than overturning it: skipped Chunks are still never generated. What changes is which stretch of the Book the element is playing. A long jump is an explicit Listener gesture in the foreground, so the reload it costs is not the background `.play()` on a freshly-loaded element that [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) identified — the constraint this phase is built around is untouched.

Seeking within the current timeline, and seeking just past its end into a Chunk the playlist can still grow to reach, both keep ticket 05's behaviour. Only a target the playlist can never reach re-points.

- [x] `/api/books/[bookId]/playlist.m3u8` accepts a start Chunk, defaulting to 0, and serves the Book from there — still truncating at the first gap at or after it, still withholding `#EXT-X-ENDLIST` until the rest of the Book is present.
- [x] `/api/books/[bookId]/manifest` accepts the same parameter and returns `startSeconds` relative to that playlist's zero, so a cue time means the same thing to the element as an `#EXTINF` sum does.
- [x] Sentence ids stay Book-global and unchanged by the start Chunk — a Sentence keeps its identity wherever the Book is played from, which is what lets the reading position and the stored resume format survive a re-point.
- [x] An out-of-range or malformed start Chunk is rejected or clamped rather than producing a playlist with no segments.
- [x] `useBookPlayer` holds the playlist's start Chunk as state, so re-pointing reuses the one `src` assignment path (and its cue reset) that ticket 05 already built for the voice change — no second place assigns `src`.
- [x] A seek whose target Sentence already has a cue still writes `currentTime` directly. No reload.
- [x] A seek into a Chunk the playlist can still grow to reach — every Chunk between the playlist's start and the target already generated — still parks via `pendingSeekRef` and lands when its cue arrives. No reload.
- [x] A seek past a gap re-points to a playlist starting at the target Chunk, and playback begins there once its cue arrives.
- [x] Look-ahead generation after a re-point runs forward from the target, and the skipped Chunks are never requested.
- [x] Seeking backwards after a re-point works, whether the target is inside the current playlist or before its start.
- [x] Tests: the route serves a playlist and a manifest from a given start Chunk with rebased times and unchanged ids; a within-timeline seek and a contiguous forward seek do not assign `src`; a seek past a gap does; the skipped Chunks are still never generated.

## Comments

### Implementation notes

**`parsePlaylistStart` is shared rather than parsed twice.** The playlist and the manifest have to agree on where the timeline's zero is; a route reading `from` one way and the other reading it another would put every cue at the wrong second, which shows up as "highlighting is slightly off" rather than as an error. It rejects rather than clamps — the client derives `from` from its own Chunk list, so anything out of range is a bug worth a 400. `Number('')` is 0, so an empty `?from=` is special-cased rather than passing for "start at the beginning".

**`from` moves the timeline's zero and nothing else.** Sentence ids stay Book-global, counted over every Chunk including the ones before the start, because a Sentence's identity can't depend on where the Book happens to be played from — that is what lets the reading position and the stored `(resumeIndex, resumeSentenceIndex)` survive a re-point untouched. Chunks before the start are still reported with their real `isGenerated`, which is what the client's reachability check reads.

**`canPlaylistReach` is the decision, and it is about the future, not the present.** Not "does this Chunk have a cue" (that is just `applySeek`) but "could this playlist ever grow to it" — true only when every Chunk from the playlist's start up to the target is narrated, since one that isn't walls off everything after it. That is what keeps ticket 05's parked seek as the answer for a target one Chunk past the end of the timeline, where re-pointing would reload the element for nothing.

**Re-pointing reuses the `src` path ticket 05 built for the voice change**, including its cue reset — `playlistStart` is just another thing `src` is derived from, so there is still exactly one assignment to `src` in the codebase. The one change that path needed was `pendingSeekRef.current ??= activeOrdinalRef.current`: a seek that caused the reload has already parked its own target and must not be overwritten with wherever reading was.

**Seeking backwards across the playlist start re-points too.** It is the same condition — the target is not on this timeline — and it falls out of `canPlaylistReach` returning false below `playlistStart` without a special case.

### Found in review

**`generatedChunksRef` was accumulating across voices.** Audio is cached per `(Book, voice)`, so what one voice had narrated says nothing about the next — but the set only ever grew, so after a voice change it kept insisting Chunks were reachable that the new voice had never generated. `canPlaylistReach` then returned true for an unreachable target, the seek parked, and nothing ever generated the Chunks in between: the exact ticket-05 hang this ticket exists to close, reintroduced one voice change later. It is now rebuilt wholesale from each manifest read, which needs no clearing logic and can't drift. The test that catches it needed the fake routes to key their cache by voice like the real one does.

**The manifest is now read on mount, not only once a Chunk finishes generating.** The old `readyChunkCount === 0` guard meant that opening a partly-narrated Book knew nothing about what was already there until the first `/api/audio-chunks` call resolved — so a Sentence click in that window would re-point for no reason, dropping the already-playable Chunks off the timeline. Reading it on mount is how the client learns the Book's state before generating anything.

**`canPlaylistReach` trusts the manifest alone.** It used to fall back to the client's own `chunkAudio` status, which is a second, disagreeing record: a Chunk can be `ready` client-side and still unplaceable, because a Chunk cached before `durationSeconds` existed fails `isPlayableChunk` (ticket 02). Guessing optimistically parks a seek forever; guessing conservatively costs one extra reload. So it only trusts what the routes report.

### Not verified in a browser

Unchanged from tickets 04 and 05: `/dev-preview` can't reach the reader, and a `window.fetch` mock can't serve HLS anyway. Coverage is 56 `AudioPlayer.test.jsx` cases driving the real component tree against a fake of the two routes that models their truncation rule, plus the routes' own tests. What no test here can tell you is how a real media stack behaves when `src` is re-pointed mid-session — whether playback resumes cleanly at the new timeline's zero on a device is worth watching during ticket 06's runs.
