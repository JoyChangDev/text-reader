# 01 — Jump-to-any-sentence seeking + auto-scroll highlighting

**What to build:** Sentence-level start/end offsets derived from each chunk's existing
word-boundary metadata (no new TTS calls or storage). The currently-playing sentence is
highlighted in sync with playback and the view auto-scrolls to keep it visible. Clicking
any sentence — including one in an already-uploaded but not-yet-generated chunk — seeks
playback there directly.

**Blocked by:** none (Phase 1 complete)

**Status:** ready-for-agent

- [x] `splitIntoSentences` is exported from `app/_lib/chunkText.js` for reuse (currently private)
- [x] A new pure function derives ordered sentence spans from (chunk text, word boundaries): each
      span's start = its first word's offset, end = its last word's `offset + duration`, converted
      to seconds
- [x] The derivation function is unit tested in isolation, including: a sentence that maps to zero
      words, a sentence that maps to exactly one word, and boundary text that doesn't exactly
      reconstruct the sentence text (TTS normalization drift)
- [x] The currently-playing sentence is highlighted via a new Chakra semantic token pair (active
      sentence bg/fg) added to `app/_providers/chakra.jsx`, driven by the `<audio>` element's
      `timeupdate` event compared against the current chunk's derived sentence spans — not a
      separate polling timer
- [x] Highlighting is tested by simulating `timeupdate` on the existing `data-testid="audio-element"`
      test seam and asserting the correct sentence receives the active style
- [x] When the highlighted sentence changes, the view auto-scrolls it into view
- [x] Manual scrolling by the reader temporarily suspends auto-scroll rather than fighting them,
      resuming after a short idle period
- [x] Clicking a sentence whose chunk is already loaded seeks `audio.currentTime` to that
      sentence's derived start
- [x] Clicking a sentence in a chunk that hasn't been generated yet immediately triggers that
      chunk's generation (bypassing `chunkFetchPlan`'s sequential look-ahead ordering for this one
      request) and begins playback at that sentence's offset once the chunk is ready, without
      generating every chunk in between
- [x] `currentIndex` moves to the target chunk as part of a cross-chunk jump, same as normal
      chunk advancement
- [x] Seeking into a not-yet-generated chunk is tested at the `useBookPlayer` level with fake
      fetch responses, asserting only the target chunk is requested, not chunks in between
- [x] The library's persisted `resumeIndex` stays chunk-level; this ticket does not add
      sentence-level resume persistence

## Comments

- Seeking-into-not-yet-generated-chunk coverage lives in `app/_components/AudioPlayer.test.jsx`,
  exercising `useBookPlayer` through a full `AudioPlayer` render rather than a standalone
  `useBookPlayer.test.js` — consistent with how every other `useBookPlayer` behavior (look-ahead,
  retry, resume) has been tested since Phase 1; no dedicated hook-only test file exists for it.
  The assertion itself (only the jump target chunk is requested, chunks skipped over are not)
  matches the spec's intent.
- `/code-review` (Standards axis) flagged duplicated "derive spans → set audio.currentTime → set
  active sentence" logic across the load-and-play effect and `seekToSentence`'s same-chunk path,
  plus an unused `currentSentenceSpans` return value — both fixed by extracting a shared
  `applySeek` helper in `useBookPlayer.js` and dropping the dead return.
