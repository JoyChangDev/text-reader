# 05 — Sentence highlighting from metadata cues, and seeking

**What to build:** Replace the `currentTime`-to-span lookup with a programmatically-built metadata `TextTrack`: one cue per Sentence, keyed by Book-global ordinal, with absolute times from the ticket 03 manifest. Highlighting reads `track.activeCues[0].id` on `cuechange`. Restore Sentence-click seeking on the continuous timeline, including into not-yet-generated regions.

**Blocked by:** 04

**Status:** ready-for-agent

The track is created with `audio.addTextTrack('metadata')` rather than declared as `<track src>`, because a `<track>`'s source is fetched once and a Book's cue set grows as Chunks generate. Adding cues is JS running during background playback, which ADR 0003 established is reliable — only `.play()` is not. This also removes the cross-origin `<track>` question the ADR listed as unverified.

`track.mode` must be `'hidden'`, not the default: cues in a `disabled` track never become active and `cuechange` never fires.

- [ ] The metadata track is created once per mount via `audio.addTextTrack('metadata')` with `mode = 'hidden'`, and a comment records why `'hidden'` is load-bearing.
- [ ] As manifest data arrives for a Chunk, its Sentences are added via `track.addCue(new VTTCue(startSeconds, endSeconds, ''))` with `cue.id` set to the Book-global Sentence ordinal.
- [ ] Adding the same Chunk's manifest data twice does not duplicate cues.
- [ ] A `cuechange` handler sets `activeSentenceIndex` from `track.activeCues[0].id`. No `timeupdate` handler is involved.
- [ ] Deleted: `findActiveSentenceIndex` at [useBookPlayer.js:35](app/_lib/useBookPlayer.js#L35), `handleTimeUpdate` at [useBookPlayer.js:371](app/_lib/useBookPlayer.js#L371) and its `onTimeUpdate` wiring, and the `currentSentenceSpans` memo at [useBookPlayer.js:119](app/_lib/useBookPlayer.js#L119).
- [ ] `deriveSentenceSpans` is no longer imported by `useBookPlayer` — its only caller is now the ticket 03 manifest route. The module and its tests stay.
- [ ] `activeSentenceIndex` is a Book-global Sentence ordinal internally, mapped to and from `(resumeIndex, resumeSentenceIndex)` at the persistence edge and to `(chunkIndex, sentenceIndex)` at the `TranscriptView` edge, so neither the stored format nor `TranscriptView`'s props change.
- [ ] Same-region seeking sets `audio.currentTime = cue.startTime` — the one remaining write to `currentTime` in the codebase, in `applySeek`.
- [ ] Seeking to a Sentence whose Chunk is not yet in the playlist keeps the existing `pendingSeekRef` behaviour: the highlight moves immediately so the Listener sees what is queued, generation is requested for that Chunk, and `currentTime` is applied once the playlist has grown to cover it.
- [ ] Seeking backwards works without reloading the element, since every earlier segment is still in the playlist. A test asserts no `src` assignment occurs on a backwards seek.
- [ ] The `AudioPlayer.test.jsx` harness gains a fake `addTextTrack` returning a stub track that records `addCue` calls and can be driven to fire `cuechange`.
- [ ] Tests: a `cuechange` naming cue `N` sets `activeSentenceIndex` to N with no `timeupdate`; manifest arrival adds exactly that Chunk's cues with absolute times; a forward seek past the generated region requests generation and defers the `currentTime` write; a backwards seek applies immediately.
- [ ] Deleted with their subjects: foreground-resync reconciliation of `activeSentenceIndex`, and any test asserting the `currentTime`-to-span lookup.
- [ ] Surviving `TranscriptView.test.jsx` coverage passes unchanged — highlighting and click reporting are driven by the same props as before.

## Comments
