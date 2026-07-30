# 05 — Resume to saved Sentence without autoplay

**What to build:** Opening a Book lands the Listener paused at the exact Sentence they last reached (not just the Chunk), and pressing play resumes from that precise Sentence. Reading position keeps saving as playback naturally advances or the Listener explicitly clicks a Sentence — never from scrolling or the position slider.

**Blocked by:** 04 (needs `resumeSentenceIndex`/`sentenceCountsByChunk` persisted in the Library)

**Status:** ready-for-agent

- [ ] Opening a Book seeds `useBookPlayer`'s pending-seek/active-Sentence state from the saved `(resumeIndex, resumeSentenceIndex)` pair, instead of always defaulting to Sentence `0` of the resumed Chunk.
- [ ] `wantsToPlay` stays `false` on open — audio never starts playing on its own.
- [ ] Pressing play right after opening resumes exactly at the saved Sentence's start time, once that Chunk's audio is ready.
- [ ] Natural playback advancing the active Sentence persists the new `(Chunk, Sentence)` reading position, debounced/coalesced so it isn't a network write on every single Sentence boundary.
- [ ] An explicit Sentence click persists the new reading position immediately.
- [ ] Simulated manual scrolling and position-slider changes never trigger a reading-position persistence call.
- [ ] `AudioPlayer.test.jsx` covers: resume-without-autoplay to a saved Sentence; natural playback persisting Sentence position; a Sentence click persisting immediately; scroll/slider changes never persisting.

## Comments
