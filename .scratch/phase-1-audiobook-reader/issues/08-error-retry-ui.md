# 08 — Chunk generation error + manual retry UI

**What to build:** When a chunk's audio generation fails, the player surfaces a visible error state on that specific chunk, with a manual retry action that re-attempts generation for that chunk only, without disturbing the reader's position or any other cached chunk.

**Blocked by:** 06 — Upload + progressive playback UI

**Status:** ready-for-agent

- [ ] A simulated/forced generation failure for a chunk results in a visible, specific error state in the UI (not a silent failure or generic crash)
- [ ] The reader can trigger a manual retry for the failed chunk
- [ ] A successful retry resumes normal playback from that chunk without affecting the reading position or previously cached chunks
- [ ] Failures on one chunk do not block playback or generation of unrelated, already-cached chunks in the same book
