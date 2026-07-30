# 01 — Player bar & Library debug-copy cleanup

**What to build:** Remove the `Chunk x of xx` counter from the player bar and the `Resumed at chunk N` fallback line from Library entries, so no screen shows Chunk-index implementation detail to the Listener. No replacement counter is added in either place.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The player bar no longer renders `Chunk x of xx` (or any Chunk-index text) anywhere, while playing, paused, or errored.
- [ ] A Library entry that previously showed "Resumed at chunk N" (i.e. has `resumeIndex > 0` but no progress data) now shows no progress line at all, matching how a never-opened Book already renders.
- [ ] Library entries that already show a progress bar/percentage are unaffected by this change.
- [ ] `PlayerBar.test.jsx` asserts no `Chunk`/`chunk` text renders in any state.
- [ ] `BookLibrary.test.jsx` asserts the legacy "resumed at chunk" copy no longer renders for any Book shape.

## Comments
