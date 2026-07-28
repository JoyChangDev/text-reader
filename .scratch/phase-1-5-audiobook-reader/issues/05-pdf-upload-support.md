# 05 — PDF upload support

**What to build:** The Listener can upload a `.pdf` file and have it narrated exactly
like a `.txt` upload today.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `BookUploader.jsx`'s file input accepts `.pdf` in addition to `.txt`
- [ ] PDF text is extracted client-side via `pdfjs-dist` before upload; the request to
      `/api/chunks` is unchanged — still `{ text }` JSON, still routed through the
      existing `chunkText`
- [ ] If extraction yields empty or near-empty text (e.g. a scanned/image-only PDF with
      no text layer), the upload is rejected with a clear, specific error message rather
      than creating an empty or garbage Book
- [ ] Extraction logic is structured so a subsequent file-type ticket (EPUB) can add its
      own case without duplicating the dispatch/validation scaffolding
- [ ] Tests cover: successful extraction feeding the existing chunk flow, and the
      empty-extraction rejection path

## Comments
