# 02 — Persist and auto-restore the last-open book

**What to build:** A `localStorage`-backed "last open book" pointer, written on entering `/book/[bookId]` and cleared on explicit "返回書庫." On a fresh `/` mount, if the pointer is present, redirect straight into `/book/[bookId]` (paused, at the last known position) instead of showing the library — so a process kill (confirmed as the likely cause of the reported "jumps back to library" and "回報 button jumps to library" symptoms) degrades to "back in your book" rather than "silently at home."

**Blocked by:** 01 (needs the real `/book/[bookId]` route to redirect into)

**Status:** resolved — verified on the device 2026-08-16. Force-quitting mid-read landed back in the Book at roughly the right place and paused, the 回報 path stayed in the Book, and an explicit 返回書庫 before the kill landed on the Library. One thing this ticket caused in [01](01-split-library-and-reader-into-routes.md) was found at the same time and fixed there — see "What the device check found".

- [x] Entering `/book/[bookId]` (route mount) writes `{ bookId }` to a `localStorage` key (e.g. `lastOpenBook`).
- [x] Pressing "返回書庫" clears that key before navigating to `/`.
- [x] On `/` mount, if the pointer is present, the app redirects to `/book/[bookId]` before rendering the library UI (no flash of the library screen first).
- [x] The restored `/book/[bookId]` session always starts with playback paused, regardless of what was in flight before the process died — no optimistic "playing" state.
- [x] If the pointed-to book has been deleted (`getBook` returns `null` for it), the stale pointer is cleared and the library renders normally instead of redirect-looping.
- [x] Simulated test: fresh `/` mount with the pointer pre-set in `localStorage` renders the reader for that book, not the library.
- [x] Simulated test: fresh `/` mount with no pointer renders the library.
- [x] Simulated test: fresh `/` mount with a pointer to a missing book clears the pointer and renders the library.
- [x] Simulated test: pressing "返回書庫" then simulating a fresh `/` mount renders the library, not the book just left.
- [x] Manually verified on the actual device: force-quitting (or leaving backgrounded long enough to get killed) mid-read and reopening lands back in the book, paused, not the library — including via the "回報" button repro path from the original report. Verified 2026-08-16 — killed while playing, reopened into the Book at roughly the right position and paused; 回報 stayed in the Book; 返回書庫 then a kill landed on the Library.

## Comments

### What the device check found

All three halves of the criterion held. Killed while playing, the app reopened into the Book at
roughly the right position and **paused** — the criterion's "no optimistic playing state", checked
specifically because playback was running when the process died. The 回報 path, which is where the
original report came from, stayed in the Book. And 返回書庫 followed by a kill landed on the
Library, which is the pointer being cleared by an explicit exit rather than surviving it.

**What this ticket cost ticket 01, found the moment the two were verified together.** Redirecting
on the pointer alone is right for a kill and wrong for a back gesture, and `/` could not tell them
apart — so back out of a Book landed on `/`, which sent the Listener straight back in. The Library
became unreachable by gesture, and this ticket's own criteria could not have caught it: none of
them mentions back, because from here the redirect is the feature.

Fixed in [ticket 01](01-split-library-and-reader-into-routes.md), where the back button is a
criterion, along with the popstate approach that looked right and did nothing. The pointer's own
behaviour is unchanged: it is still written on entering the reader, still cleared by 返回書庫, and
is deliberately **not** cleared by a back gesture — a Listener who navigates back and is then killed
on the Library should get the Library. What changed is that `/` now asks whether it is being reached
for the first time in this document before acting on it.
