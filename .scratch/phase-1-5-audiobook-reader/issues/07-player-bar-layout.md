# 07 — Player bar layout + component split

**What to build:** The reader gets a persistent, media-player-style bottom bar (controls,
icons) separate from the scrollable transcript, replacing the current bare play/pause
button UI.

**Blocked by:** 02, 04

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] `AudioPlayer.jsx` is split into a scrollable `TranscriptView` (owns the sentence
      highlighting/auto-scroll behavior from ticket 01, unchanged) and a fixed/sticky
      `PlayerBar` at the bottom of the viewport that stays in place while the transcript
      scrolls
- [x] `react-icons` is added as a dependency; play/pause (and any skip controls) use
      standard media-player glyphs instead of text labels
- [x] The voice Select from ticket 02 and the speed control from ticket 04 are relocated
      into the new `PlayerBar`
- [x] Existing chunk-level playback behavior (play/pause, retry, chunk advancement) is
      preserved exactly — this ticket is a layout/component restructuring, not a
      behavior change
- [x] Existing tests for `AudioPlayer`/`useBookPlayer` are updated to match the new
      component boundary and continue passing

## Comments
