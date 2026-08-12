# 08 — Whole-book progress scrubber

**What to build:** The player bar gets a real, draggable progress scrubber spanning the
entire book (not just the current chunk), showing the Listener where they are in the
whole book and letting them jump anywhere — including into not-yet-generated chunks.

**Blocked by:** 07

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] Each chunk's estimated duration is computed from its character count once at least
      one chunk has been generated for the current voice, using the observed
      `duration / characterCount` ratio from already-generated chunks; a rough default
      ratio is used before any chunk has been generated
- [x] As each chunk actually generates, its estimated duration is replaced with its real
      duration, and the scrubber's total length/position recalculates accordingly
- [x] The scrubber visually distinguishes generated (exact-duration) segments from
      estimated (not-yet-generated) segments
- [x] Dragging the scrubber to a point within an already-generated chunk seeks playback
      there directly (reusing ticket 01's derived sentence-span seeking where
      applicable)
- [x] Dragging the scrubber to a point within a not-yet-generated chunk triggers that
      chunk's generation immediately (same bypass-of-sequential-lookahead behavior as
      ticket 01's sentence click-to-seek) and begins playback at the target offset once
      ready
- [x] The duration-estimation function (chunk text/char count + observed ratio →
      estimated duration) is a pure function, unit tested in isolation
- [x] Scrubber interaction and generated/estimated styling are tested by simulating chunk
      generation completing and asserting the segment styling and total-duration
      recalculation update correctly

## Comments

- New `app/_lib/bookProgress.js` holds the pure functions: `estimateChunkDuration`,
  `chunkDurationFromBoundaries`, `computeSecondsPerChar` (the observed ratio, scoped to
  the current voice per ADR 0002), `buildBookTimeline` (the whole-book segment list), and
  `locateBookOffset`/`locateSentenceIndexForOffset` (drag-target → chunk/sentence
  resolution). All unit tested in isolation in `bookProgress.test.js`.
- `useBookPlayer.js`'s new `seekToBookOffset` resolves a drag target to a
  (chunkIndex, sentenceIndex) pair and hands off to the existing `seekToSentence` (ticket 01) rather than reimplementing the ready/not-ready seek paths - this surfaced a
  pre-existing race between the load-and-play effect and the chunk-change reset effect
  (both react to `currentIndex`) that ticket 01's own tests never exercised, since it only
  manifests when the jump target is a chunk that's already generated but not currently
  active. Fixed via a `seekAppliedIndexRef` guard; covered by
  `AudioPlayer.test.jsx`'s new "seeks directly to the sentence at that offset" test.
- New `ProgressScrubber.jsx` renders the segment track (color distinguishes generated vs
  estimated) with a transparent-track `<input type="range">` layered on top for native
  drag/keyboard support.
- `/code-review` (Spec axis) flagged that the observed ratio wasn't actually scoped to the
  current voice, and that a ready chunk with empty boundaries would mismatch its
  "generated" styling against an estimated duration value - both fixed: chunkAudio entries
  now carry the voice they were generated under, and `isEstimated`/duration-source now
  agree (a chunk still contributes its own real duration once generated even after a
  voice switch, but no longer pollutes the new voice's ratio).
