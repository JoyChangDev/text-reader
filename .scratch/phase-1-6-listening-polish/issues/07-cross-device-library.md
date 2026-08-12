# 07 — Cross-device library (list/add/get/update resume position)

**What to build:** Move the Library (a book's chunk text and resume position) from
device-local `localStorage` to Vercel Blob, so a book uploaded on one device can be seen
and resumed from any other device.

**Blocked by:** 01

**Status:** resolved

- [x] `libraryService.js` implements `listBooks()`, `addBook({ bookId, title, chunks })`,
      `getBook(bookId)`, `updateResumeIndex(bookId, resumeIndex)`, persisted via the shared
      storage seam using a two-tier shape: a compact `library/index.json` summary list plus
      a per-book chunks blob
- [x] `GET /api/library`, `POST /api/library`, and `PATCH /api/library/[bookId]` routes are
      implemented and tested the same way `chunks/route.test.js` already is (plus a
      `GET /api/library/[bookId]` route, needed for `getBook` to fetch a single book's
      chunks)
- [x] `bookLibrary.js` is reimplemented as an async client calling these routes instead of
      `localStorage`, keeping its existing exported function names/shapes
- [x] Call sites (`BookLibrary.jsx`, `page.jsx`, and `useBookPlayer.js`'s resume-index
      persistence effect) are updated for the now-async calls
- [x] A book uploaded from one browser/device appears in the library list and resumes from
      the correct position when opened from a different browser/device
- [x] `bookLibrary.test.js` is rewritten against the fetch-based client (mocked fetch);
      `libraryService.test.js` covers the persistence logic against a faked storage client
- [x] `listenerSettings.js` (device-scoped voice/speed prefs) is untouched — only Library
      data moves server-side

## Comments
