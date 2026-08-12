# 04 — Text-scroll-position indicator (replaces the whole-book scrubber)

**What to build:** Replace the seconds/duration-based whole-book progress scrubber with a
simple indicator of how far the listener has scrolled through the book's text, fully
decoupled from audio playback position or chunk duration.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] `bookProgress.js` and ADR 0002 are removed from the codebase
- [x] `ProgressScrubber` and `useBookPlayer.js`'s `timeline`/`buildBookTimeline`/
      `bookPositionSeconds`/`seekToBookOffset` are removed
- [x] New indicator computes a percentage purely from the transcript container's scroll
      position (`scrollTop`/`scrollHeight`/`clientHeight`) — no chunk index or duration
      data involved
- [x] Dragging or clicking the indicator sets the transcript's scroll position from the
      target percentage; it never sets `audio.currentTime` or triggers chunk/sentence
      seeking
- [x] `PlayerBar.jsx` no longer receives/renders `segments`/`totalSeconds`/
      `bookPositionSeconds`/`onSeek` props
- [x] Sentence-highlighting during playback (`sentenceSpans.js`) is unaffected — only the
      scrubber-related code is removed
- [x] New tests simulate scroll container dimensions in JSDOM and assert the reported
      percentage and drag-to-scroll behavior

## Comments

- Implemented as a new `ScrollPositionIndicator.jsx`, rendered inside `TranscriptView.jsx`
  above the scrollable container (which now holds a `scrollContainerRef`). Percentage is
  tracked in `TranscriptView` state, recomputed on every scroll event (including
  programmatic ones from auto-scroll/"jump to now playing", so the indicator stays in
  sync) and on mount. `formatDuration.js` was left in place — it's unused by app code now,
  but it's a `teach`-skill learning exercise file unrelated to this ticket's scope, not
  part of the scrubber removal.
