# 04 — Audio Generation Service — single-chunk generation (the one seam)

**What to build:** A server-side module and API route that, given a chunk of text, a book/chunk identifier, and the fixed default voice, returns a playable audio URL and boundary-timing metadata. Internally it checks the object storage cache first, and only calls `edge-tts` on a cache miss, then persists the result before returning. This module is the single seam between the rest of the app and its two external dependencies (the `edge-tts` client and the storage client) — nothing else in the app should call those clients directly.

**Blocked by:** 01 — Project test infrastructure

**Status:** resolved

- [x] An API route accepts a chunk of text (plus a book/chunk identifier and voice) and returns a real, playable audio URL and boundary-timing metadata
- [x] The underlying `edge-tts` integration runs as a pure Node/TypeScript port with no Python dependency
- [x] Generated audio and its boundary metadata are persisted in Vercel Blob, keyed by (book id, chunk index, voice id)
- [x] Calling the route a second time with the same book id, chunk index, and voice returns the cached result without invoking `edge-tts` again
- [x] The service module exposes a single public interface that the API route depends on; the `edge-tts` client and storage client are not called from anywhere else
- [x] Unit tests exercise the service module's behavior (cache hit, cache miss, generation failure) using fake `edge-tts`/storage clients substituted at the seam — no real network calls in tests

## Comments

Implementation was already in place (`audioGenerationService.js`, `blobStorageClient.js`, `edgeTtsClient.js`, `app/api/audio-chunks/route.js`). Verified each criterion against the code and confirmed the two new unit tests (persist-failure propagation, empty-text 400) close the remaining gaps in coverage. Full suite (22 tests) and lint pass; `@vercel/blob`'s `get()` was checked against its type definitions and does resolve `null` on a 404 as the code assumes.
