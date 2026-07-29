# 05 — Chunk-to-chunk audio preloading

**What to build:** Eliminate the audible gap between chunks caused by the next chunk's
audio only starting to load once the current one ends, by buffering the next chunk's
actual audio ahead of time.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `useBookPlayer.js` maintains two `<audio>` elements (active/standby) instead of one
- [ ] As soon as the next chunk's audio is ready, its actual audio bytes begin loading into
      the standby element in the background while the current chunk is still playing
- [ ] On chunk advance, playback switches to the already-buffered standby element rather
      than assigning a cold `src` and waiting on a fresh load
- [ ] Existing chunk-advancement, look-ahead (`chunkFetchPlan`), retry, and error-state
      behavior is preserved unchanged
- [ ] Tests simulate both audio elements' readiness/events and assert the swap happens
      without a fresh-load delay

## Comments
