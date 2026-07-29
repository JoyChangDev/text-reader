# 03 — "Jump to now playing" button

**What to build:** A control that scrolls the transcript back to the currently-playing
sentence on demand, so a listener who scrolled ahead to read can get back to their
listening position without hunting for it.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A visible button/control scrolls the transcript to the active sentence when clicked,
      reusing the existing auto-scroll ref/behavior
- [ ] Works correctly whether or not auto-scroll is currently suspended (i.e. the reader
      recently scrolled manually)
- [ ] Test coverage asserts the scroll-into-view behavior fires on click

## Comments
