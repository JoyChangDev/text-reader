# 08 — Whole-book progress scrubber

**What to build:** The player bar gets a real, draggable progress scrubber spanning the
entire book (not just the current chunk), showing the Listener where they are in the
whole book and letting them jump anywhere — including into not-yet-generated chunks.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Each chunk's estimated duration is computed from its character count once at least
      one chunk has been generated for the current voice, using the observed
      `duration / characterCount` ratio from already-generated chunks; a rough default
      ratio is used before any chunk has been generated
- [ ] As each chunk actually generates, its estimated duration is replaced with its real
      duration, and the scrubber's total length/position recalculates accordingly
- [ ] The scrubber visually distinguishes generated (exact-duration) segments from
      estimated (not-yet-generated) segments
- [ ] Dragging the scrubber to a point within an already-generated chunk seeks playback
      there directly (reusing ticket 01's derived sentence-span seeking where
      applicable)
- [ ] Dragging the scrubber to a point within a not-yet-generated chunk triggers that
      chunk's generation immediately (same bypass-of-sequential-lookahead behavior as
      ticket 01's sentence click-to-seek) and begins playback at the target offset once
      ready
- [ ] The duration-estimation function (chunk text/char count + observed ratio →
      estimated duration) is a pure function, unit tested in isolation
- [ ] Scrubber interaction and generated/estimated styling are tested by simulating chunk
      generation completing and asserting the segment styling and total-duration
      recalculation update correctly

## Comments
