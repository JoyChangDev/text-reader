# 01 — Split library and reader into real routes

**What to build:** Replace the single `/` route's in-memory `book` state with two real Next.js routes: `/` (library only) and `/book/[bookId]` (reader, rendering `AudioPlayer`). `/book/[bookId]` fetches its own data via `getBook(bookId)` rather than receiving `chunks`/`initialIndex` as props from a parent holding them in memory. This Next.js install is v16.2.10 — read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` before implementing, since `params` is a Promise in this version, not the synchronous prop older examples assume.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] `app/book/[bookId]/page.jsx` exists as a Client Component route, renders `AudioPlayer` for the book matching the route's `bookId` param.
- [x] `app/page.jsx` no longer holds a `book` state variable or conditionally renders `AudioPlayer` — it only renders the library view (`BookUploader`, `BookLibrary`, `BlobUsageIndicator`, the settings/report-link footer).
- [x] `BookLibrary`'s `onSelect` navigates to `/book/[bookId]` (router navigation, not `setBook`).
- [x] `BookUploader`'s `onReady` handler (after its `addBook` call persists the new book server-side) navigates to `/book/[bookId]` for the newly created book.
- [x] `AudioPlayer`'s "返回書庫" button performs a real navigation to `/` (no more `onBackToLibrary` prop that just flips local state in the parent).
- [x] `/book/[bookId]` fetches the book via `getBook(bookId)`, passing the resolved `chunks`/`resumeIndex`/`resumeSentenceIndex`/`title` into `AudioPlayer` the same way `handleSelectBook` does today.
- [x] If `getBook(bookId)` resolves to `null` (deleted book / bad link), the route redirects to `/` instead of rendering a broken player.
- [x] Existing `AudioPlayer.test.jsx`/`useBookPlayer` tests pass with only the prop-plumbing changes needed for the route split — no behavioral regressions in playback, look-ahead fetch, ping-pong preload, or Sentence-click seeking.
- [ ] Manually verified: selecting a book from the library, reading a bit, and pressing "返回書庫" round-trips correctly with real URL changes (browser back button works as expected). _(Needs Joy to verify on-device; not checkable from here.)_

## Comments
