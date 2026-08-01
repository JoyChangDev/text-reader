# 02 — Persist and auto-restore the last-open book

**What to build:** A `localStorage`-backed "last open book" pointer, written on entering `/book/[bookId]` and cleared on explicit "返回書庫." On a fresh `/` mount, if the pointer is present, redirect straight into `/book/[bookId]` (paused, at the last known position) instead of showing the library — so a process kill (confirmed as the likely cause of the reported "jumps back to library" and "回報 button jumps to library" symptoms) degrades to "back in your book" rather than "silently at home."

**Blocked by:** 01 (needs the real `/book/[bookId]` route to redirect into)

**Status:** ready-for-agent

- [x] Entering `/book/[bookId]` (route mount) writes `{ bookId }` to a `localStorage` key (e.g. `lastOpenBook`).
- [x] Pressing "返回書庫" clears that key before navigating to `/`.
- [x] On `/` mount, if the pointer is present, the app redirects to `/book/[bookId]` before rendering the library UI (no flash of the library screen first).
- [x] The restored `/book/[bookId]` session always starts with playback paused, regardless of what was in flight before the process died — no optimistic "playing" state.
- [x] If the pointed-to book has been deleted (`getBook` returns `null` for it), the stale pointer is cleared and the library renders normally instead of redirect-looping.
- [x] Simulated test: fresh `/` mount with the pointer pre-set in `localStorage` renders the reader for that book, not the library.
- [x] Simulated test: fresh `/` mount with no pointer renders the library.
- [x] Simulated test: fresh `/` mount with a pointer to a missing book clears the pointer and renders the library.
- [x] Simulated test: pressing "返回書庫" then simulating a fresh `/` mount renders the library, not the book just left.
- [ ] Manually verified on the actual device: force-quitting (or leaving backgrounded long enough to get killed) mid-read and reopening lands back in the book, paused, not the library — including via the "回報" button repro path from the original report. _(Needs Joy to verify on-device; not checkable from here.)_

## Comments
