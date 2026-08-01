# 03 — On-screen diagnostic panel for background reconciliation

**What to build:** A temporary, always-visible on-screen panel that logs key background/foreground events to a capped `localStorage` ring buffer as they happen, and renders the persisted log on mount — so what happened right before a process kill is visible on the next launch without a Mac or remote debugger. This exists to gather the real-device evidence ticket 04 needs; it should be removed once ticket 04 ships.

**Blocked by:** 01 (avoid building this against the soon-to-be-replaced single-route layout)

**Status:** ready-for-agent

- [x] A capped `localStorage` ring buffer (e.g. last 50 entries) records, with timestamps: `visibilitychange` firing (+ `document.visibilityState`), `focus` firing, each reconciliation-checkpoint run and what it found/corrected (`isPlaying` mismatch corrected true/false, `activeSentenceIndex` correction from/to, whether a missed chunk-advance was triggered), and MediaSession registration outcome (`'mediaSession' in navigator`, whether handlers attached successfully).
- [x] A small collapsible panel renders in the reader UI, showing the current log contents in a readable format (most recent first).
- [x] On mount, the panel displays whatever was already logged before this mount adds anything new — i.e., surviving a full reload and still showing what happened just before it.
- [x] A "清除記錄" control clears the log.
- [x] The code is clearly marked as temporary (e.g. a `// TEMPORARY:` comment block or an isolated file) so it's easy to find and delete later.
- [x] Existing tests for `useBookPlayer`/`AudioPlayer` are unaffected by the panel's presence (it observes, doesn't change playback/reconciliation behavior).

## Comments

- 2026-08-01, post-deploy: Joy reported the panel's toggle button showed a correct count ("除錯記錄（34）") but expanding it showed no entries. Root cause: `AudioPlayer.jsx`'s root `Box` was the only screen in the app using a hard `h="100vh"` + `overflow="hidden"` (every other route uses `minH="100vh"`, which never clips). `100vh` doesn't reliably match the true visible viewport on iOS Safari (the dynamic toolbar changes the actual visible area); expanding the panel pushed its content past that true edge, where `overflow="hidden"` silently clipped it instead of scrolling to reveal it. Fixed by changing `h="100vh"` → `h="100dvh"` in `AudioPlayer.jsx`, plus `flexShrink={0}` on the panel's own root `Box` so it's never the flex child sacrificed under pressure (`TranscriptView` is the one designed to shrink, via its own `minH={0}`).
