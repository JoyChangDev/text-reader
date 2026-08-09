# 06 — A failed write reads as an empty Book, not as a failure

**What to build:** Make a Book that could not be stored say so. Three layers each turn a failed
write into a plausible-looking absence, and together they produce a Book that is listed,
openable, and silently unreadable.

**Blocked by:** —

**Status:** ready-for-agent

Found while diagnosing [ticket 05](05-cut-over-and-measure.md)'s first real upload. That
ticket's bug — a `411 MissingContentLength` on the chunks blob — is fixed. This one is what
made a one-line fix cost an investigation: nothing anywhere reported that the upload had
failed. The Listener saw a Book in the Library, opened it, and got a reader with no text and a
play button that did nothing.

The same three layers will do the same thing to the next write that fails, whatever the cause.

## The three layers

**1. The client discards the status.** [`bookLibrary.js`](../../../app/_lib/bookLibrary.js)'s
`addBook` is `return response.json()`. The route answers `502` with
`{ error: 'Adding the book to the library failed' }`, which is valid JSON, so nothing throws
and the caller receives an object that simply is not a Book.
[`BookUploader.jsx`](../../../app/_components/BookUploader.jsx) has a `catch` that sets a
visible error, but it can only fire for `/api/chunks` — it checks that response's `ok` and
never this one. So the upload reports success and the app navigates into the Book.

**2. The server writes the index first, and does not roll back.** In
[`libraryService.js`](../../../app/_lib/libraryService.js):

```js
await storageClient.putJson(INDEX_KEY, [...index, summary]);
await storageClient.putJson(chunksKey(bookId), chunks);
```

A failure of the second write leaves the first committed. The index then advertises a Book —
with a real `title` and a real `totalChunks` — whose text was never stored. Observed exactly
this on 2026-08-10: `library/index.json` present, `library/<bookId>/chunks.json` absent.

**3. The reader turns the missing blob into an empty Book.** `getBook` reads
`(await storageClient.get(chunksKey(bookId))) ?? []`. That `??` is right for the blobs where
absence is genuinely a valid state — a Book with no stored resume position has not been started
— but for the chunks blob absence is corruption. An index entry exists precisely because the
chunks were supposed to have been written.

## Acceptance criteria

- [ ] A failed `POST /api/library` surfaces as a visible error in the uploader, rather than
      navigating into the new Book. The existing error string is already there; it needs to be
      reachable.
- [ ] `bookLibrary.js` stops treating a non-2xx response as data. Whatever shape this takes, it
      applies to every call in that module, not only `addBook` — `getBook` and `deleteBook`
      already check `response.ok`; `addBook`, `listBooks` and `updateResumeIndex` do not, and
      that inconsistency is itself the bug's hiding place. `listBooks` is worth a look on its
      own: it destructures `books` off the parsed body, so a 502 there yields `undefined`
      rather than a list.
- [ ] A Book is not left in the index when its chunks blob was not written. Either the chunks
      blob is written first, or the index entry is removed when the second write fails.
- [ ] A chunks blob that is missing when the index says it should exist is distinguishable from
      a Book with no chunks — it must not silently render as an empty reader.
- [ ] Whatever the reader does in that case, it is something a Listener can act on: an error
      with a way back to the Library, not a dead play button.
- [ ] Covered by tests at the seam that failed — a store whose second write rejects, asserted
      from `addBook` through to what `getBook` then reports.

## Comments

### Writing chunks first is the obvious ordering, and it has its own cost

Swapping the two writes makes the index the commit point, which is the right shape: nothing is
advertised until everything behind it exists. The cost is the mirror-image leak — a chunks blob
with no index entry, invisible to the Library and to `deleteBook`'s cascade, occupying R2
forever.

That is strictly the better failure of the two (wasted bytes rather than a broken Book), and
[`blobCleanupService.js`](../../../app/_lib/blobCleanupService.js) already exists to sweep
objects the index does not account for — worth checking whether it covers the `library/` prefix
or only audio before assuming the orphan is collected.

### Do not "fix" this by making the reader tolerant

The tempting small change is to have the reader show a friendly message when `chunks` is empty.
That treats the symptom and keeps the corrupt index entry, which will then be re-encountered on
every launch and on every device. The Book should stop existing, or stop being incomplete.

### Why this was worth its own ticket rather than a line in ticket 05

Ticket 05's defect was one missing header on one code path. This one is a property of how the
Library's write path and read path handle failure, and it will outlive the R2 migration
entirely — the same three layers behaved the same way when the store was Vercel Blob. Fixing
the `411` removed the trigger that happened to be in front of us, not the mechanism.
