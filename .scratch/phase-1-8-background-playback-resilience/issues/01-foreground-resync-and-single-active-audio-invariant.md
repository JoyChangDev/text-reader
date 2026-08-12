# 01 — Foreground/background resync and single-active-audio invariant

**What to build:** A `visibilitychange`/`focus`-driven reconciliation checkpoint in `useBookPlayer` that treats the real `<audio>` elements as ground truth on return to foreground — correcting `isPlaying`, `activeSentenceIndex`, and `currentIndex` (if a chunk boundary was crossed while hidden) to match what the elements actually did — plus a blanket invariant that at most one of the primary/secondary elements is ever unpaused, enforced both at that checkpoint and after every `audio.play()` call the hook already makes.

**Blocked by:** None — can start immediately

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] A `visibilitychange` listener (plus a `focus` fallback) is attached once at the `useBookPlayer` level and cleaned up on unmount.
- [x] On becoming visible, if the active `<audio>` element's actual `paused` state disagrees with `isPlaying`/`wantsToPlay`, React state is corrected to match the element (not the reverse).
- [x] On becoming visible, if the active element's `currentTime` falls outside every span in `currentSentenceSpans`, `activeSentenceIndex` is recomputed using the same lookup `handleTimeUpdate` already uses (no duplicated logic).
- [x] On becoming visible, if the active element's loaded chunk no longer matches `currentIndex` (an `ended` boundary was crossed while hidden without `onEnded` firing/being processed), the existing `handleEnded` chunk-advance path is invoked rather than a new mechanism.
- [x] A helper enforces "at most one of primary/secondary is unpaused" — called at the end of the reconciliation function, and immediately after each existing `audio.play()` call in the "load and play" effect ([useBookPlayer.js:211](app/_lib/useBookPlayer.js#L211), [useBookPlayer.js:213](app/_lib/useBookPlayer.js#L213)).
- [x] Simulating both elements' `paused` reporting `false` at once, then dispatching `visibilitychange` → visible, results in exactly the non-active element's `pause()` being called.
- [x] Simulating a missed Sentence-boundary crossing (currentTime past all spans) then dispatching `visibilitychange` → visible updates `activeSentenceIndex` without a further `timeupdate` event.
- [x] Existing `AudioPlayer.test.jsx`/`useBookPlayer` coverage (look-ahead fetch, ping-pong preload, ordinary play/pause, Sentence-click seeking) still passes unchanged.

## Comments
