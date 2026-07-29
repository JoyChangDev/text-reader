# 08 — Deleting a book cascades to its Blob audio

**What to build:** Let the listener remove a book from the library, with its generated
chunk audio cleaned up automatically rather than left orphaned in Blob storage.

**Blocked by:** 01, 07

**Status:** done

- [x] The library UI gains a way to delete a book from the list
- [x] `libraryService.js` gains `deleteBook(bookId)`
- [x] `DELETE /api/library/[bookId]` removes the book's entry from `library/index.json`,
      deletes its chunks blob, and deletes every one of that book's audio/metadata blobs via
      the shared `list`/`del` seam
- [x] After deleting a book, it no longer appears in the library list on next load, and its
      audio blobs are gone (verified via the shared fake storage client in tests)
- [x] Test coverage at the route/service level against a faked storage client — no real
      Blob calls

## Comments
