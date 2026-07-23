# 05 — Whole-book progressive generation orchestration

**What to build:** Given the full text of an uploaded book, apply the chunking function to produce an ordered chunk list, then expose an API that lets the frontend request and generate chunk audio in order, one chunk ahead of the current playback position, reusing the Audio Generation Service for each individual chunk.

**Blocked by:** 03 — Chinese sentence chunking function, 04 — Audio Generation Service

**Status:** done

- [x] Given a full text body, an API endpoint returns the ordered list of chunks (or chunk identifiers) for that text
- [x] A second API endpoint, given a book id and chunk index, returns that chunk's audio URL and metadata, generating it via the Audio Generation Service if not already cached
- [x] Requesting chunks out of order (e.g. jumping ahead) works correctly and does not generate or return the wrong chunk's audio
- [x] The full sequence of a short sample text can be walked end-to-end via API calls alone (no UI), producing correct, in-order audio for every chunk
- [x] Integration-level tests cover requesting a full short book's worth of chunks in order, verifying correct chunking and correct audio/metadata pairing

## Comments

Added `POST /api/chunks` (given `{ text }`, returns the ordered `chunks` array from the existing `chunkText` function — array index doubles as chunk identifier). The existing `POST /api/audio-chunks` route from ticket 04 already satisfies the second endpoint: it's keyed by `(bookId, chunkIndex, voice)` and checks the Audio Generation Service's cache before generating, so out-of-order and cached-replay requests already work correctly without new orchestration logic. Note the route still requires `text` in the request body on every call, including cache hits — there's no backend database to look chunk text up from bookId+chunkIndex alone (by design, see the spec's "no backend database" decision), so the frontend must always send the chunk's text alongside its index; the endpoint just won't re-generate audio for it on a cache hit. The "one chunk ahead of playback" sequencing itself is client-side behavior, out of scope here (ticket 06). Added `app/api/audio-chunks/progressiveGeneration.test.js`, an integration test that fakes only the two lowest-level external dependencies (`@vercel/blob`, `edge-tts-universal`) and walks both routes together end-to-end: full in-order generation, jumping ahead out of order, and cached replay with no duplicate synthesis call.
