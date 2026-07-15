# 05 — Whole-book progressive generation orchestration

**What to build:** Given the full text of an uploaded book, apply the chunking function to produce an ordered chunk list, then expose an API that lets the frontend request and generate chunk audio in order, one chunk ahead of the current playback position, reusing the Audio Generation Service for each individual chunk.

**Blocked by:** 03 — Chinese sentence chunking function, 04 — Audio Generation Service

**Status:** ready-for-agent

- [ ] Given a full text body, an API endpoint returns the ordered list of chunks (or chunk identifiers) for that text
- [ ] A second API endpoint, given a book id and chunk index, returns that chunk's audio URL and metadata, generating it via the Audio Generation Service if not already cached
- [ ] Requesting chunks out of order (e.g. jumping ahead) works correctly and does not generate or return the wrong chunk's audio
- [ ] The full sequence of a short sample text can be walked end-to-end via API calls alone (no UI), producing correct, in-order audio for every chunk
- [ ] Integration-level tests cover requesting a full short book's worth of chunks in order, verifying correct chunking and correct audio/metadata pairing
