# 06 — Upload + progressive playback UI

**What to build:** A page where the reader selects or drops a `.txt` file. The file's text is read client-side, sent to the orchestration API, and playback of the first chunk begins as soon as it's ready — while subsequent chunks generate in the background via a small look-ahead buffer, not the whole book at once. Basic play/pause controls are available.

**Blocked by:** 05 — Whole-book progressive generation orchestration

**Status:** resolved

- [x] A reader can select or drop a `.txt` file from a page in the app
- [x] Playback of the first chunk begins within a couple of seconds of upload, without waiting for the whole book to be processed
- [x] While one chunk plays, a small number of upcoming chunks generate in the background so playback doesn't stall at chunk boundaries under normal conditions
- [x] Play and pause controls work correctly during playback
- [x] Chunks play back in the correct order with no gaps or overlaps between them

## Comments

Replaced the placeholder home page with two new client components under `app/_components/`: `BookUploader` (a `<label>` + file input, click-to-select or drag-and-drop onto the same dropzone; reads the file as text client-side, POSTs it to `/api/chunks`, and hands `{ bookId, chunks }` up once chunked) and `AudioPlayer` (renders one hidden `<audio>` element plus play/pause, driven by a new `useBookPlayer` hook). `app/page.jsx` just switches between the two based on whether a book has been uploaded yet; nothing is persisted across reloads (that's ticket 07).

`useBookPlayer` (`app/_lib/useBookPlayer.js`) is the sequential-chunk player described in the spec: it keeps a `chunkIndex -> { status, url }` map, tops up a look-ahead buffer of the current chunk plus the next 2 (via a new pure `chunkFetchPlan` helper, TDD'd first in isolation) by calling `/api/audio-chunks` per chunk, and swaps the single `<audio>` element's `src` and calls `.play()` once the current chunk is ready. On `ended`, it advances to the next chunk (or stops if it was the last one), which naturally re-triggers the look-ahead effect to fetch further ahead — so the whole book is never requested at once, only a small rolling window ahead of playback.

Voice selection and per-chunk error/retry UI are intentionally absent, per scope (voice is hardcoded server-side already; ticket 08 owns error UI). A chunk that fails to generate is tracked internally as `'error'`, and `chunkFetchPlan` deliberately won't retry it automatically (no auto-retry-with-backoff, per spec). If the chunk lined up next already failed by the time playback reaches it, the player stops signalling as "playing" (falls back to showing the Play button) instead of silently stalling with Pause still showing and nothing audible — a minimal, non-error-UI fix for "play/pause controls work correctly," not an attempt at ticket 08's visible error/retry state.

Along the way, found and fixed a latent gap in the test setup: `vitest.setup.js` had no `afterEach(cleanup)`, so `@testing-library/react`'s own auto-cleanup (which only registers itself if a real global `afterEach` exists, and this project imports test hooks per-file rather than via Vitest's `globals` option) was never wired up. It happened not to matter until now because no earlier test file rendered more than once per file; `BookUploader.test.jsx`'s multiple `render()` calls exposed it (duplicate DOM nodes across tests). Fixed once, centrally, in the shared setup file.

`/code-review` (Standards + Spec axes) caught a few things, since fixed: the error message used a raw `red.500` instead of a semantic token (added a `danger` token to the Chakra provider, per the spec's token-architecture decision); an import reaching into `_lib` via a relative path instead of the established `@/app/_lib/...` alias; the audio-ready effect re-calling `.play()` on every unrelated look-ahead status change instead of only when the current chunk's readiness actually changed (now scoped to just that chunk's status/url); and tracking the loaded chunk index via a DOM `dataset` attribute instead of a `useRef` (state living outside React's model). The stalled-Pause-button fix above also came out of that review.

Tests added: `chunkFetchPlan.test.js` (pure, TDD'd first), `BookUploader.test.jsx`, `AudioPlayer.test.jsx` (mocks `fetch` and stubs `HTMLMediaElement.play`/`pause`, since jsdom doesn't implement them; drives the full sequence — look-ahead fetch, play, `ended` advances to the next chunk and tops up the buffer, pause), and a rewritten `app/page.test.jsx` covering the upload-to-player handoff end-to-end.
