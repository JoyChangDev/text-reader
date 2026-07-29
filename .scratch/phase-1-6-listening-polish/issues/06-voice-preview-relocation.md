# 06 — Voice preview relocated to upload/library screen

**What to build:** Let the listener preview available voices before opening a book, not
only from inside the player.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Preview logic currently inline in `AudioPlayer.jsx` (preview audio element, toggle
      behavior, sample URL lookup) is extracted into a shared component/hook
- [ ] Voice preview is available and functional from the upload/library screen, before any
      book is opened
- [ ] Voice preview inside `PlayerBar` continues to work unchanged, now built on the shared
      implementation instead of a separate copy
- [ ] Test coverage for the shared preview component/hook, exercised from both call sites

## Comments
