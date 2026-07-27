# 08 — Chunk generation error + manual retry UI

**What to build:** When a chunk's audio generation fails, the player surfaces a visible error state on that specific chunk, with a manual retry action that re-attempts generation for that chunk only, without disturbing the reader's position or any other cached chunk.

**Blocked by:** 06 — Upload + progressive playback UI

**Status:** done

- [x] A simulated/forced generation failure for a chunk results in a visible, specific error state in the UI (not a silent failure or generic crash)
- [x] The reader can trigger a manual retry for the failed chunk
- [x] A successful retry resumes normal playback from that chunk without affecting the reading position or previously cached chunks
- [x] Failures on one chunk do not block playback or generation of unrelated, already-cached chunks in the same book

## Comments

The current chunk's error/retry is surfaced in `AudioPlayer.jsx`: when `chunkAudio[currentIndex].status === 'error'`, the Play button is replaced by a `Retry` button and a `role="alert"` message appears (no more misleading disabled Play button). `useBookPlayer.js` already tracked per-chunk error status and already left errored chunks alone in `chunkFetchPlan` (no auto-retry, and unrelated chunks in the look-ahead window were never blocked by one chunk's failure); the only gap was a manual retry entry point, added by exposing the existing `fetchChunk` as `retryChunk` — clicking Retry re-runs the same fetch, and since `wantsToPlay` is untouched by an error, a successful retry resumes playback automatically without an extra Play click. Covered by two new tests in `AudioPlayer.test.jsx`: retrying the current chunk's failure, and retrying a look-ahead chunk's failure after playback has advanced onto it (confirming the unrelated next chunk still generated in the background and position/playback resume correctly).
