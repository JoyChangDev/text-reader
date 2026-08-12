# 02 — Transcript polish: immediate auto-scroll & hidden scrollbar

**What to build:** Auto-scroll to the now-playing Sentence snaps immediately instead of animating, so the transcript visibly keeps pace with narration. The transcript's native scrollbar is hidden while all existing scroll mechanisms (manual scroll, auto-follow, "jump to now playing", the bottom position slider) keep working exactly as today.

**Blocked by:** None — can start immediately

**Status:** resolved — built and in the code, confirmed against the codebase on 2026-08-12. The boxes below were never ticked: that is unfilled paperwork, not open work. They have not been audited line by line, so trust the code over the checkboxes here.

- [ ] The transcript's scroll-to-active-Sentence call is immediate (no smooth/animated transition), for both natural playback advance and "jump to now playing".
- [ ] The existing suspend-on-manual-scroll / resume-after-idle-delay behavior is unchanged.
- [ ] The transcript's scroll container has no visible scrollbar in supported browsers (cross-browser hiding: `scrollbar-width: none` plus a WebKit `::-webkit-scrollbar` override), while `overflow-y: auto` (and thus scrolling itself) is preserved.
- [ ] The bottom position slider still reads and drives the transcript's scroll position correctly with the scrollbar hidden.
- [ ] `TranscriptView.test.jsx` asserts the snap-to-active-Sentence call is immediate rather than smooth, and that scrollbar-hiding styling is present on the scroll container.

## Comments
