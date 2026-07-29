# 04 — Text-scroll-position indicator (replaces the whole-book scrubber)

**What to build:** Replace the seconds/duration-based whole-book progress scrubber with a
simple indicator of how far the listener has scrolled through the book's text, fully
decoupled from audio playback position or chunk duration.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `bookProgress.js` and ADR 0002 are removed from the codebase
- [ ] `ProgressScrubber` and `useBookPlayer.js`'s `timeline`/`buildBookTimeline`/
      `bookPositionSeconds`/`seekToBookOffset` are removed
- [ ] New indicator computes a percentage purely from the transcript container's scroll
      position (`scrollTop`/`scrollHeight`/`clientHeight`) — no chunk index or duration
      data involved
- [ ] Dragging or clicking the indicator sets the transcript's scroll position from the
      target percentage; it never sets `audio.currentTime` or triggers chunk/sentence
      seeking
- [ ] `PlayerBar.jsx` no longer receives/renders `segments`/`totalSeconds`/
      `bookPositionSeconds`/`onSeek` props
- [ ] Sentence-highlighting during playback (`sentenceSpans.js`) is unaffected — only the
      scrubber-related code is removed
- [ ] New tests simulate scroll container dimensions in JSDOM and assert the reported
      percentage and drag-to-scroll behavior

## Comments
