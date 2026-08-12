# 05 — Sentence highlighting from metadata cues, and seeking

**What to build:** Replace the `currentTime`-to-span lookup with a programmatically-built metadata `TextTrack`: one cue per Sentence, keyed by Book-global ordinal, with absolute times from the ticket 03 manifest. Highlighting reads `track.activeCues[0].id` on `cuechange`. Restore Sentence-click seeking on the continuous timeline, including into not-yet-generated regions.

**Blocked by:** 04

**Status:** resolved — the code landed with every criterion ticked; what kept this open was the "Still not verified in a browser" note below, which hands the question to ticket 06. **Ticket 06 answered it on a device:** its "look-ahead is a second witness" section shows 44 Chunks generated during the backgrounded run, and the look-ahead only advances from the `cuechange` handler — so `cuechange` was firing against a growing EVENT playlist. That is the evidence this ticket was waiting for. Closed 2026-08-12.

The track is created with `audio.addTextTrack('metadata')` rather than declared as `<track src>`, because a `<track>`'s source is fetched once and a Book's cue set grows as Chunks generate. Adding cues is JS running during background playback, which ADR 0003 established is reliable — only `.play()` is not. This also removes the cross-origin `<track>` question the ADR listed as unverified.

`track.mode` must be `'hidden'`, not the default: cues in a `disabled` track never become active and `cuechange` never fires.

- [x] The metadata track is created once per mount via `audio.addTextTrack('metadata')` with `mode = 'hidden'`, and a comment records why `'hidden'` is load-bearing.
- [x] As manifest data arrives for a Chunk, its Sentences are added via `track.addCue(new VTTCue(startSeconds, endSeconds, ''))` with `cue.id` set to the Book-global Sentence ordinal.
- [x] Adding the same Chunk's manifest data twice does not duplicate cues.
- [x] A `cuechange` handler sets `activeSentenceIndex` from `track.activeCues[0].id`. No `timeupdate` handler is involved.
- [x] Deleted: `findActiveSentenceIndex` at [useBookPlayer.js:35](app/_lib/useBookPlayer.js#L35), `handleTimeUpdate` at [useBookPlayer.js:371](app/_lib/useBookPlayer.js#L371) and its `onTimeUpdate` wiring, and the `currentSentenceSpans` memo at [useBookPlayer.js:119](app/_lib/useBookPlayer.js#L119). _Done in ticket 04 — see its notes: left in place, the mapping doesn't degrade the highlight, it overwrites the Listener's saved Sentence._
- [x] `deriveSentenceSpans` is no longer imported by `useBookPlayer` — its only caller is now the ticket 03 manifest route. The module and its tests stay. _Done in ticket 04, with the deletion above._
- [x] `activeSentenceIndex` is a Book-global Sentence ordinal internally, mapped to and from `(resumeIndex, resumeSentenceIndex)` at the persistence edge and to `(chunkIndex, sentenceIndex)` at the `TranscriptView` edge, so neither the stored format nor `TranscriptView`'s props change.
- [x] Same-region seeking sets `audio.currentTime = cue.startTime` — the one remaining write to `currentTime` in the codebase, in `applySeek`.
- [x] Seeking to a Sentence whose Chunk is not yet in the playlist keeps the existing `pendingSeekRef` behaviour: the highlight moves immediately so the Listener sees what is queued, generation is requested for that Chunk, and `currentTime` is applied once the playlist has grown to cover it. _Completed by [ticket 07](07-seeking-past-the-generated-region.md), which covers the case this ticket left unreachable — see "The gap a forward seek leaves behind" below._
- [x] Seeking backwards works without reloading the element, since every earlier segment is still in the playlist. A test asserts no `src` assignment occurs on a backwards seek.
- [x] The `AudioPlayer.test.jsx` harness gains a fake `addTextTrack` returning a stub track that records `addCue` calls and can be driven to fire `cuechange`. _Installed from `vitest.setup.js` rather than the test file — see the notes._
- [x] Tests: a `cuechange` naming cue `N` sets `activeSentenceIndex` to N with no `timeupdate`; manifest arrival adds exactly that Chunk's cues with absolute times; a forward seek past the generated region requests generation and defers the `currentTime` write; a backwards seek applies immediately.
- [x] Deleted with their subjects: foreground-resync reconciliation of `activeSentenceIndex`, and any test asserting the `currentTime`-to-span lookup. _Both went in ticket 04._
- [x] Surviving `TranscriptView.test.jsx` coverage passes unchanged — highlighting and click reporting are driven by the same props as before.

## Comments

### Carried over from ticket 04

Two of the deletions above are already done (ticked, with the reason). Three things ticket 04 left for this one, beyond its own checklist:

- **The look-ahead anchor.** `currentIndex` no longer advances during playback, so a listening session generates `LOOKAHEAD` Chunks and stops. The `cuechange` handler this ticket adds is what restores an advancing anchor — until it does, a Book longer than the window stops playing at the end of the generated region. Ticket 06 depends on this.
- **`applySeek` / `pendingSeekRef` / `seekAppliedIndexRef` were deleted, not kept.** Their only surviving job was a `currentTime` write using a Chunk-relative offset, which is wrong on the Book-wide timeline. Rebuild them here around cue times rather than expecting to find them.
- **Resume no longer positions the audio.** Opening a Book part-way through starts it from the beginning; the saved Sentence is highlighted and persisted, but nothing maps it to a time. Mapping `(resumeIndex, resumeSentenceIndex)` to a cue is this ticket's job.

### Implementation notes

**`currentIndex` is now derived, not stored.** The hook holds one piece of position state — the Book-global ordinal — and both `currentIndex` and `activeSentenceIndex` fall out of it via `sentenceOrdinals.js`. That is what restores the look-ahead anchor without anything new having to advance it: a `cuechange` moves the ordinal, `currentIndex` follows, and `chunkFetchPlan` widens the generated region ahead of playback. `setCurrentIndex` is gone; the two can no longer disagree. `TranscriptView`'s props and the stored `(resumeIndex, resumeSentenceIndex)` are unchanged, as required — the translation happens at both edges.

**`sentenceOrdinals.js` counts Sentences from the Chunk text**, via the same `splitIntoSentences` the server's `bookManifest.js` counts with. That shared rule is the whole reason a cue id from the manifest names the same Sentence on the client. It is what lets an ordinal exist for a Sentence whose Chunk has not generated — which a Sentence click on an ungenerated Chunk needs. Out-of-range input clamps rather than propagating, since a stored resume position can outlive the chunking it was saved against.

**The jsdom stand-ins live in `vitest.setup.js`, not `AudioPlayer.test.jsx`.** jsdom has no `VTTCue` at all, and its `addTextTrack` is a declared-but-unimplemented stub returning `undefined` — so without these, every existing `AudioPlayer` test would have crashed on mount, not just the new ones. Same category as the `scrollIntoView` and `matchMedia` stubs already there. The fake track is a real `EventTarget` with a working `cues.getCueById`, so the hook makes the same calls it makes in a browser; what it deliberately does not do is work `activeCues` out from the clock, because when the media stack decides a cue changed is not what is under test here.

**Voice change clears the cues.** Not on the checklist, but a different voice is a different timeline, and cues from the old one are wrong rather than merely stale. The reload path drops them and re-parks the reading position, which the new voice's manifest resolves to a new time. Tested.

**A parked seek suppresses `cuechange`.** Found in review, and it is the ticket-04 failure wearing a different hat. While a seek waits for its Chunk, the playhead is still where it was and keeps crossing cues that have nothing to do with where the Listener asked to be. Following them drags the highlight backwards _and_ persists it — so opening a Book part-way through, then pressing play before the saved Sentence's cue arrives, would overwrite the saved place with Sentence 0. `handleCueChange` returns early while `pendingSeekRef` is set.

**The metadata track is reused, not re-added.** A `TextTrack` can be added to an element but never removed, and React mounts effects twice under the StrictMode Next runs in development — so the effect looks for an existing metadata track before adding one, or dev would accumulate empty duplicates.

### The gap a forward seek leaves behind

Not introduced here, not fixed here. **Resolved by [ticket 07](07-seeking-past-the-generated-region.md)**, which keeps the phase-1.5 rule below and moves the playlist instead of filling the gap.

`seekToSentence` deliberately generates only the target Chunk, never the ones skipped over — a phase-1.5 rule, with a test enshrining it, and correct when each Chunk was its own audio file. It no longer holds. The playlist truncates at the first gap (`hlsPlaylist.js`) and the manifest follows it, so a Chunk past an ungenerated one has no `startSeconds` and gets no cues. Meanwhile the look-ahead anchor has moved to the target, so `chunkFetchPlan` runs forward from there and never goes back to fill the gap.

Concretely: on a 20-Chunk Book, opening it generates 0–10; clicking a Sentence in Chunk 15 generates 15 alone; Chunks 11–14 are never requested by anything; the playlist stays 11 segments long; the parked seek waits forever and playback stops at the end of Chunk 10.

Seeking within or just past the generated region — the case ticket 06 needs, and the common one — works, and is what the deferred-seek test covers.

Fixing the gap meant choosing a policy, which is a spec-level tradeoff rather than a call to make inside this ticket. It was settled in favour of serving the Book from the Chunk the Listener landed on: the skipped Chunks stay ungenerated, and the reload it costs falls on an explicit foreground gesture, which is not the failure ADR 0003 identified. See ticket 07.

### Still not verified in a browser

Same position as ticket 04, for the same reason: `/dev-preview` cannot reach the reader, and its `window.fetch` mock could not serve HLS anyway (a `<audio src>` playlist/segment load never goes through `fetch`), so a real preview needs the actual playlist/manifest routes backed by fixtures. Coverage here is the 50 `AudioPlayer.test.jsx` cases against the real component tree, plus 11 for `sentenceOrdinals`. Whether `cuechange` fires as expected on a growing EVENT playlist in the background is exactly what ticket 06 has to answer on a device.
