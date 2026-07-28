# 06 — EPUB upload support

**What to build:** The Listener can upload an `.epub` file and have it narrated exactly
like a `.txt` upload today.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `BookUploader.jsx`'s file input accepts `.epub` in addition to `.txt` (and `.pdf`
      if 05 has already landed — extend the same dispatch rather than duplicating it)
- [ ] EPUB text is extracted client-side via `epub.js`; all chapters are concatenated
      into one flat plain-text blob (chapter breaks preserved only as paragraph breaks)
      — no chapter is modeled as a first-class concept, matching the flat Chunk-index
      domain model in `CONTEXT.md`
- [ ] The request to `/api/chunks` is unchanged — still `{ text }` JSON, still routed
      through the existing `chunkText`
- [ ] If extraction yields empty or near-empty text (e.g. a corrupted or DRM-protected
      EPUB), the upload is rejected with a clear, specific error message
- [ ] Tests cover: successful multi-chapter extraction feeding the existing chunk flow,
      and the empty-extraction rejection path

## Comments
