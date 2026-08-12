# 03 — Flush resume-position persistence on backgrounding

**What to build:** When the page is backgrounded (`visibilitychange` → `hidden`, with `pagehide` as a fallback), immediately call the existing `persistResumePosition(currentIndex, activeSentenceIndex)`, bypassing the normal `RESUME_PERSIST_DEBOUNCE_MS` (400ms) debounce — so a tab fully killed by the OS while backgrounded doesn't lose the last few seconds of reading position.

**Blocked by:** None — can start immediately (independent of tickets 01/02)

**Status:** resolved — built and in the code, confirmed against the codebase on 2026-08-12. The boxes below were never ticked: that is unfilled paperwork, not open work. They have not been audited line by line, so trust the code over the checkboxes here.

- [ ] `visibilitychange` → `document.visibilityState === 'hidden'` triggers an immediate `persistResumePosition` call, not routed through the existing debounce timer.
- [ ] `pagehide` triggers the same immediate flush as a fallback.
- [ ] The existing debounce/coalescing behavior (`lastPersistedRef`, the `setTimeout` in the persistence effect) is unchanged for ordinary foreground playback — this only adds the two backgrounding-triggered flush points, reusing `persistResumePosition` rather than a second persistence path.
- [ ] Simulating `visibilitychange` → hidden immediately after a Sentence advance (before the 400ms debounce would otherwise fire) results in the library PATCH call happening right away (asserted via `AudioPlayer.test.jsx`'s existing `libraryPatchCalls()` helper).
- [ ] No duplicate persistence call fires when the debounce timer would have already covered the same (chunkIndex, sentenceIndex) pair.

## Comments
