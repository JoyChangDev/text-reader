# 04 — Sentence-level Library progress

**What to build:** The Library shows each Book's progress as a Sentence-level percentage instead of a Chunk-level one, computed from per-Chunk Sentence counts recorded at upload time — without needing to fetch a Book's full Chunk text just to render the Library list. Books saved before this change (no Sentence-level metadata) keep showing their existing Chunk-level percentage.

**Blocked by:** None — can start immediately

**Status:** resolved — built and in the code, confirmed against the codebase on 2026-08-12. The boxes below were never ticked: that is unfilled paperwork, not open work. They have not been audited line by line, so trust the code over the checkboxes here.

- [ ] Uploading a Book (`addBook`) computes and persists `sentenceCountsByChunk` (one Sentence count per Chunk, via the same sentence-splitting logic the transcript already uses for rendering) into the Library index summary, alongside the existing `resumeIndex`/`totalChunks`.
- [ ] The Library index summary gains a `resumeSentenceIndex` field (defaulting to `0`).
- [ ] A pure helper computes a Book's overall percentage from `sentenceCountsByChunk` + `resumeIndex` + `resumeSentenceIndex` alone (no Chunk-text fetch), clamped at both ends.
- [ ] A Book with no Sentence-level metadata (added before this change) falls back to today's Chunk-level percentage calculation — no missing-field errors, no fabricated progress.
- [ ] `BookLibrary.jsx` renders the Sentence-level percentage when available, and the legacy Chunk-level percentage otherwise.
- [ ] `libraryService.test.js` / `bookLibrary.test.js` cover: `addBook` computing `sentenceCountsByChunk` correctly from given Chunk text; a legacy Book (missing the new fields) still reading back successfully.
- [ ] The pure progress helper has its own unit tests: correct percentage, clamping, the legacy fallback path, and edge cases (single-Sentence Book, single-Chunk Book, resume position at the very last Sentence).
- [ ] `BookLibrary.test.jsx` covers both the Sentence-level and legacy-fallback rendering paths.

## Comments
