# 03 — On-screen diagnostic panel for background reconciliation

**What to build:** A temporary, always-visible on-screen panel that logs key background/foreground events to a capped `localStorage` ring buffer as they happen, and renders the persisted log on mount — so what happened right before a process kill is visible on the next launch without a Mac or remote debugger. This exists to gather the real-device evidence ticket 04 needs; it should be removed once ticket 04 ships.

**Blocked by:** 01 (avoid building this against the soon-to-be-replaced single-route layout)

**Status:** ready-for-agent

- [ ] A capped `localStorage` ring buffer (e.g. last 50 entries) records, with timestamps: `visibilitychange` firing (+ `document.visibilityState`), `focus` firing, each reconciliation-checkpoint run and what it found/corrected (`isPlaying` mismatch corrected true/false, `activeSentenceIndex` correction from/to, whether a missed chunk-advance was triggered), and MediaSession registration outcome (`'mediaSession' in navigator`, whether handlers attached successfully).
- [ ] A small collapsible panel renders in the reader UI, showing the current log contents in a readable format (most recent first).
- [ ] On mount, the panel displays whatever was already logged before this mount adds anything new — i.e., surviving a full reload and still showing what happened just before it.
- [ ] A "清除記錄" control clears the log.
- [ ] The code is clearly marked as temporary (e.g. a `// TEMPORARY:` comment block or an isolated file) so it's easy to find and delete later.
- [ ] Existing tests for `useBookPlayer`/`AudioPlayer` are unaffected by the panel's presence (it observes, doesn't change playback/reconciliation behavior).

## Comments
