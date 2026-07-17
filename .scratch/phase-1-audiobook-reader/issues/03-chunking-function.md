# 03 — Chinese sentence chunking function

**What to build:** A pure function that takes raw text and splits it into an ordered list of chunks, each roughly 2–4 sentences long, bounded by a maximum character count, using Chinese sentence-ending punctuation (`。`, `！`, `？`) as split points.

**Blocked by:** 01 — Project test infrastructure

**Status:** ready-for-agent

- [x] Given a sample Chinese paragraph, the function returns an ordered list of chunks, each ending on a sentence boundary
- [x] No chunk exceeds the configured maximum character count
- [x] Chunks are grouped in batches of roughly 2–4 sentences, not strictly one sentence per chunk
- [x] Edge cases are handled and unit-tested: text shorter than one full chunk, text with no terminal punctuation at the very end, and consecutive punctuation marks (e.g. `。」`)
- [x] The function is unit tested in isolation, with no dependency on the TTS pipeline or storage
