# 07 — Seeking past the generated region, by starting the playlist there

**What to build:** Give the playlist and manifest routes a start Chunk, so a Sentence click that lands beyond what the playlist can reach re-points the element at a playlist beginning at that Chunk instead of parking a seek that can never be applied.

**Blocked by:** 05

**Status:** resolved — 2026-08-16, on the second device run. The first one failed and produced
[tickets 15](15-the-re-point-races-the-generation-it-asked-for.md),
[16](16-resuming-past-a-gap-never-re-points.md) and
[17](17-a-generated-chunk-past-the-gap-reads-as-ungenerated.md); with all three landed, a forward
seek past an ungenerated stretch and a backward seek to an earlier one both play what was chosen,
and reopening the Book holds the position with the audio matching. See "What the device check
found" and "What the second run found" below.

**Superseded status, kept for the record:** blocked — the device check was run on 2026-08-16 and
**failed**. Re-pointing does not resume cleanly, for two reasons that are not this ticket's to fix: [ticket 15](15-the-re-point-races-the-generation-it-asked-for.md) (the re-point races the generation it just asked for, so the element is handed a segment-less playlist and errors unrecoverably) and [ticket 16](16-resuming-past-a-gap-never-re-points.md) (the next launch reopens the Book with the audio and the highlight in different places). Re-verify this ticket once both land. See "What the device check found" below.

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

### What the device check found

Run on an iPhone, Safari, 2026-08-16, on a 2,372-Chunk Book. The check this ticket was held open
for — seek past an ungenerated stretch and watch playback resume — did not pass, and the two causes
are recorded as their own tickets rather than reopened here, because neither is a defect in what
this ticket built.

**The seek produced 播放時發生錯誤，請重新整理後再試。** Not the `SRC_NOT_SUPPORTED` message: this is
iPhone Safari, which has native HLS. The re-point sets `playlistStart` to the target Chunk before
`fetchChunk` has produced it, so the element is pointed at a playlist with no segments and no
`ENDLIST`, and nothing reassigns `src` when the Chunk later arrives.
Measured against the running route: `?from=0` → 200 with 17 segments, `?from=17` and `?from=500` →
200 with **zero**. [Ticket 15](15-the-re-point-races-the-generation-it-asked-for.md).

**Reloading then opened the Book with the audio and the highlight in different places.**
`playlistStart` is `useState(0)` on mount, so the resume position past the gap parked forever and
the audio played from Chunk 0. Tapping the highlighted Sentence fixed it, by doing the re-point the
mount should have done. [Ticket 16](16-resuming-past-a-gap-never-re-points.md).

**Corroboration that the jump never completed:** the Book's generated Chunks are 0–16, contiguous.
The far Chunk was never produced. `fetchChunk` was called; its result had nowhere to go.

### What this ticket got right, and why it still needs re-verifying

The three-way decision is sound and is not what failed. `canPlaylistReach` correctly distinguishes
a parked seek from a re-point, and the two non-re-pointing cases work. What ticket 15 exposes is
that the re-pointing case was only ever exercised against a target that already existed — in tests,
and in the one manual seek ticket 06 logged. A long seek is by definition a seek to a Chunk that
does not exist yet, so the case this ticket exists for is the case that was never run end to end.

Re-run the same check once 15 and 16 land: jump past an ungenerated stretch, watch playback resume
there, then reopen the Book and confirm the first thing heard matches the highlight.

### What the second run found

Re-run once 15, 16 and 17 had landed. All four checks passed: the Book opened where it was left and
played the right words, a forward seek past an ungenerated stretch showed the wait and then played
the chosen Sentence, a backward seek to an earlier stretch did the same, and a reload held the
position with the audio still matching.

**The backward seek is worth singling out.** This ticket has always had a criterion for it —
"Seeking backwards after a re-point works, whether the target is inside the current playlist or
before its start" — and it was ticked on the strength of a unit test against a fake that reported
`isGenerated` for Chunks the real routes never described. In production it could not have worked:
the manifest reported every Chunk before `from` as ungenerated, so the client was never told the
target existed and could not decide to re-point to it. Ticket 17 is what made it true, and this run
is the first time it has actually been observed.

Three of this ticket's ticks were like that — right in the fake, unreachable in the app. The
lesson is recorded in 17 rather than here, since that is where the fixture was corrected.
