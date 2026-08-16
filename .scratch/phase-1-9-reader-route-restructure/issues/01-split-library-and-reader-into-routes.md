# 01 — Split library and reader into real routes

**What to build:** Replace the single `/` route's in-memory `book` state with two real Next.js routes: `/` (library only) and `/book/[bookId]` (reader, rendering `AudioPlayer`). `/book/[bookId]` fetches its own data via `getBook(bookId)` rather than receiving `chunks`/`initialIndex` as props from a parent holding them in memory. This Next.js install is v16.2.10 — read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` before implementing, since `params` is a Promise in this version, not the synchronous prop older examples assume.

**Blocked by:** None — can start immediately

**Status:** resolved — verified on the device 2026-08-16, after a fix. The round-trip and the URL changes were right, but the back button could never reach the Library: that took a change to how `/` decides to restore, written up in "The back button never got out of a Book" below. One narrower case is left as it is, deliberately and on Joy's call.

- [x] `app/book/[bookId]/page.jsx` exists as a Client Component route, renders `AudioPlayer` for the book matching the route's `bookId` param.
- [x] `app/page.jsx` no longer holds a `book` state variable or conditionally renders `AudioPlayer` — it only renders the library view (`BookUploader`, `BookLibrary`, `BlobUsageIndicator`, the settings/report-link footer).
- [x] `BookLibrary`'s `onSelect` navigates to `/book/[bookId]` (router navigation, not `setBook`).
- [x] `BookUploader`'s `onReady` handler (after its `addBook` call persists the new book server-side) navigates to `/book/[bookId]` for the newly created book.
- [x] `AudioPlayer`'s "返回書庫" button performs a real navigation to `/` (no more `onBackToLibrary` prop that just flips local state in the parent).
- [x] `/book/[bookId]` fetches the book via `getBook(bookId)`, passing the resolved `chunks`/`resumeIndex`/`resumeSentenceIndex`/`title` into `AudioPlayer` the same way `handleSelectBook` does today.
- [x] If `getBook(bookId)` resolves to `null` (deleted book / bad link), the route redirects to `/` instead of rendering a broken player.
- [x] Existing `AudioPlayer.test.jsx`/`useBookPlayer` tests pass with only the prop-plumbing changes needed for the route split — no behavioral regressions in playback, look-ahead fetch, ping-pong preload, or Sentence-click seeking.
- [x] Manually verified: selecting a book from the library, reading a bit, and pressing "返回書庫" round-trips correctly with real URL changes (browser back button works as expected). Verified 2026-08-16 — the round-trip and the URLs were right as built; the back button was not, and now is. See below.

## Comments

### The back button never got out of a Book

Found verifying this ticket and [02](02-persist-and-auto-restore-last-open-book.md) together on
the device, which is the only way it could have been found: it exists in the gap between them.
This ticket asked that the back button work and was written before the pointer existed. Ticket 02
made `/` redirect whenever it finds a pointer, and never mentions back. Neither ticket is wrong on
its own terms, and the combination made `返回書庫` the only exit from a Book that existed.

**What happened.** Back from `/book/<id>` reached `/`, which found the pointer still set — the
Listener had not left the Book, they had navigated out of it — and `router.replace`d straight back
into the reader. Because it replaces rather than pushes, pressing back repeatedly did not even
accumulate. The Library was unreachable by gesture.

**The first fix was wrong, and only a real browser said so.** The obvious move is to treat a back
gesture as an exit and clear the pointer, from a `popstate` listener in the reader. Its unit test
passed and it did nothing at all in a browser: popstate listeners run in registration order, the
router's own handler is registered first, and it re-renders and unmounts the reader — taking the
listener with it — before that listener would have fired. **A component cannot reliably listen for
the navigation that unmounts it.** Recorded because the code looks correct and the test agrees.

**What the probe did find** is the signal that actually separates the two cases. A cold launch is a
new document; an in-app back gesture is the same document still running. So the reader marks a
module-scoped flag on mount, and `/` restores only when that flag is clear — first arrival in this
document. The flag's lifetime is the document's, which is exactly the distinction, and it costs
nothing to keep. `resetReaderOpened()` exists only because one jsdom document is shared by a whole
test file; a real launch resets it for free.

Verified in the browser both ways: back now reaches the Library **with the pointer still set**, so
a kill still restores; and a cold launch with a pointer still lands in the Book, paused, with the
Library never rendered.

### Back straight after a restore is left as it is

**Decided by Joy, 2026-08-16.** Cold-launch into a restored Book and press back, and you stay in
the Book. This is not the bug above and is not fixed by it: `/` reaches the reader via
`router.replace`, so the `/` entry is consumed and there is nothing behind it to go back to.

Changing `replace` to `push` would make back reach the Library, and is safe now that the flag stops
it looping. It is deliberately not done. The case only arises in Safari — a Home Screen launch has
no back button at all — and the cost is that back would stop leaving the app from a cold launch,
which is ordinary behaviour for a landing page. `返回書庫` is the way out.
