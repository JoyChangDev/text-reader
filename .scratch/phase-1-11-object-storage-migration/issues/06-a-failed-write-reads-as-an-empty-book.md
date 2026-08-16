# 06 — A failed write reads as an empty Book, not as a failure

**What to build:** Make a Book that could not be stored say so. Three layers each turn a failed
write into a plausible-looking absence, and together they produce a Book that is listed,
openable, and silently unreadable.

**Blocked by:** —

**Status:** resolved — 2026-08-16. The one thing left open at close was looked at and both
halves of it are now answered: the HLS routes answer 409 rather than 502 (the write-up below
that said otherwise was stale in a way that mattered — see "Reviewed at close"), and the
reader's incomplete-Book screen was finally seen in the running app, delete branch included.
One thing found on the way is **not** this ticket's and is recorded at the bottom under
"Found while closing".

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

- [x] A failed `POST /api/library` surfaces as a visible error in the uploader, rather than
      navigating into the new Book. The existing error string is already there; it needs to be
      reachable.
- [x] `bookLibrary.js` stops treating a non-2xx response as data. Whatever shape this takes, it
      applies to every call in that module, not only `addBook` — `getBook` and `deleteBook`
      already check `response.ok`; `addBook`, `listBooks` and `updateResumeIndex` do not, and
      that inconsistency is itself the bug's hiding place. `listBooks` is worth a look on its
      own: it destructures `books` off the parsed body, so a 502 there yields `undefined`
      rather than a list.
- [x] A Book is not left in the index when its chunks blob was not written. Either the chunks
      blob is written first, or the index entry is removed when the second write fails.
- [x] A chunks blob that is missing when the index says it should exist is distinguishable from
      a Book with no chunks — it must not silently render as an empty reader.
- [x] Whatever the reader does in that case, it is something a Listener can act on: an error
      with a way back to the Library, not a dead play button.
- [x] Covered by tests at the seam that failed — a store whose second write rejects, asserted
      from `addBook` through to what `getBook` then reports.
- [x] A browser that cannot play the source says so. On a browser without native HLS the play
      button currently does nothing at all, with no message — see "The same shape, in the
      player" below.

## Comments

### What was built

Three layers, three changes, in the order the ticket names them.

**The client.** `bookLibrary.js` reads the status before the body — one `readJson` helper that
throws with the status on it, used by all five calls. `getBook` and `deleteBook` keep 404 →
`null`, because "there is no such Book" is an answer the reader route acts on rather than a
failure. The uploader needed no change at all once `addBook` rejected: `BookUploader`'s
existing `catch` already wraps its `await onReady(...)`, so the string that was there is now
reachable, and `router.push` no longer runs. `BookLibrary` gained a `.catch` — it is one
section of the Library route rather than the whole of it, so a failure leaves it empty rather
than taking the page down.

**The server.** `addBook` writes the chunks blob first and the index last, making the index
the commit point. When the index write fails it deletes the chunks blob it just wrote, best
effort, and rethrows either way — the ordering's own leak, closed, because
`blobCleanupService` excludes the `library/` prefix and nothing else would ever collect it.

**The reader.** `getBook` no longer defaults a missing chunks blob to `[]`; it throws an error
carrying `code: BOOK_INCOMPLETE`, the route answers `409`, and the reader route shows a message
naming what happened, a 刪除這本書 button, and a 返回書庫 button. Deliberately not a redirect:
an automatic bounce back to the Library would hide a permanently corrupt Book exactly as the
empty reader did.

The delete button is what answers "the Book should stop existing" below. Offering it here
rather than telling the Listener to go and find the entry in the Library is the difference
between the ticket being closed and being described — and there is nothing to weigh up, since
the entry advertises text that exists nowhere. It runs the Library's ordinary cascade delete,
and a delete that itself fails leaves the message on screen rather than pretending it worked.

The last-open pointer is dropped only for the permanent failure. A corrupt Book fails
identically on every launch, so auto-restoring into it would put the Listener on this error
screen every time they open the app; a store that could not be reached is not that, and
forgetting the Book would make a blip cost them their place.

### The 409 is written out twice, on purpose

`libraryService.js` names the condition `BOOK_INCOMPLETE`, the route answers a literal `409`,
and `bookLibrary.js` names that status `INCOMPLETE_BOOK_STATUS` for the reader to compare
against. One concept, three spellings — but the two modules cannot share a constant in either
direction: importing `libraryService.js` into the client module would pull the object storage
client and `aws4fetch` into the browser bundle, and importing the client wrapper into the route
inverts the dependency. Each side carries a comment pointing at the other.

### The playlist routes now answer 502 for an incomplete Book

> **Superseded at close, 2026-08-16.** Both routes answer 409 now, and the reasoning below was
> already out of date when it was written — `readBookAudio` had stopped calling `getBook`. See
> "Reviewed at close" at the bottom. Kept in place because the decision it records ("left as
> it is, for a state a Listener cannot get to") is the one that was overturned.

`bookAudio.readBookAudio` calls the same `libraryService.getBook`, so the throw reaches
`/api/books/[bookId]/playlist.m3u8` and `/manifest` too. Both already wrap their lookup, so
each returns its own 502 rather than crashing — but 502 is the "the store is down, try again"
answer, and for this Book it will never come true. It is unreachable in practice, because
opening the Book now fails first and the reader never mounts a player. Left as it is rather
than threaded through two more routes for a state a Listener cannot get to; noted here because
the next person to read those routes' logs deserves to know why a 502 might be permanent.

### Verified against the real store, for the player half

The media-element half was confirmed in the running app rather than only in jsdom: opening the
Book from ticket 05's cutover in Chromium at `localhost:3100` gave `audio.error.code === 4` and
the new message on screen. That is the exact failure the ticket describes, reproduced and then
made visible.

The reader's incomplete-Book screen was not eyeballed the same way — producing one would have
meant deleting a real Book's chunks object out of R2. It is covered by tests at the route, the
client and the page, and it is built from the same Box/VStack/Button primitives the route's
existing loading state uses.

> **The other error screen was eyeballed, 2026-08-11**, when 重新載入 was added to it. The Book
> read was made to fail with a 502 by replacing `window.fetch` in the running app — no real data
> touched — and the screen rendered its message, 重新載入 and 返回書庫. Restoring `fetch` and
> pressing 重新載入 opened the Book. The incomplete-Book screen is the same component with one
> button swapped, so this covers its layout too; what stays untested by eye is the 409 branch's
> own wording and its delete.

### The Listener could be told to try again, but not actually try — fixed 2026-08-11

The generic branch said 「無法載入這本書，請稍後再試。」 and then offered only 返回書庫. Trying again
meant leaving and coming back, which is the same request with extra steps — and on the device
this cost a real session: a reopen after a network blip landed here with nowhere to go.

`重新載入` clears the error and re-runs the read, which puts the loading spinner back so the
retry looks like something happened. **It is deliberately not offered on the 409 branch**: a
Book whose text was never stored fails identically every time, so a retry there would be a
button guaranteed not to work. That branch already has the remedy that fits it, which is
刪除這本書 — the same distinction the pointer-clearing rule draws, for the same reason.

This is the last of the criterion "something a Listener can act on" that was answered only for
the permanent failure when this ticket was closed.

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

### The same shape, in the player

Found on 2026-08-10 while verifying the R2 cutover from a desktop browser: playback produced no
sound and no message. The whole serving path was healthy — segments 200'd from the Worker with
real MP3 bytes, and the playlist was well-formed and served as
`application/vnd.apple.mpegurl` — but the media element had:

```
code: 4                                       // MEDIA_ERR_SRC_NOT_SUPPORTED
message: "PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE"
```

That is Chromium refusing the playlist because it has no HLS demuxer. Nothing is broken:
[ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) sets the `.m3u8` as the element's
`src` and depends on native HLS, having explicitly rejected MSE, and its own spike section says
it covered iOS only. Safari and iOS play this; Chrome, Edge and Firefox on the desktop cannot,
and there is no hls.js in the dependency tree by design.

**The defect is the silence, not the lack of support.** `audio.error` is populated and nothing
reads it, so an unsupported browser is indistinguishable from a dead button. This belongs here
rather than in a "desktop support" ticket, which is a different and much larger question: the
fix is to surface the error the element already reports, not to add a playback path.

Low priority against the criteria above — the target device is iPhone and this app currently
has one Listener — but it cost an investigation once already, and it will cost one again the
first time somebody opens the app on a laptop.

### Reviewed at close, 2026-08-16

**The 502 note above was describing code that no longer existed.** It said `readBookAudio`
calls `getBook`; it calls `getBookSummary`, and `readBookChunks` only when it will actually use
the text — [ticket 12](../../phase-1-10-continuous-hls-playback/issues/12-the-playlist-route-reads-the-whole-book-per-poll.md)
took the whole-Book read off the polled path after this ticket was written. So the two routes
were not doing the same thing as each other at all:

- **The manifest** always reads the Chunk text (`bookManifest` counts Sentence ordinals from
  it), so it always throws `BOOK_INCOMPLETE` and always answered 502. The note was right here.
- **The playlist** reads the text only for a Book indexed before `addBook` recorded
  `totalChunks`. For every other Book it never opens the chunks blob, so it never throws — it
  serves whatever the Chunk index says, which for an incomplete Book is not a 502 at all.

That second line is why the note was worth more than a status-line correction. "Both routes
answer 502" is a wrong description that reads as a tolerable one; what was actually there was a
route that cannot tell an incomplete Book from an unnarrated one — the ticket's own defect
shape, one layer down.

**What was changed:** both routes now answer `409`, matching `/api/library/[bookId]`, with a
test each. The overturned reasoning was "unreachable, so leave it": true, and the cost of not
leaving it is five lines and an import that only ever runs on the server. A 502 is a standing
instruction to retry, and this one can only fail again — it would have cost somebody an
investigation exactly the way the silence this ticket is named after did.

**What was deliberately not changed:** the playlist still cannot detect an incomplete Book that
has a recorded `totalChunks`, and should not learn to. The only way to know is to read the
chunks blob, which is the 1.6 MB per poll ticket 12 removed — paid forever, on the app's
hottest path, to detect a state that no Listener can reach because opening the Book fails at
`/api/library/[bookId]` first. The route says so at the `catch`.

### The reader's incomplete-Book screen, seen at last — 2026-08-16

The gap the Status line named. Verified in the running app at `localhost:3100` the same way the
generic branch was on 2026-08-11: `window.fetch` replaced in the page so that one made-up
bookId answers `409`, no real Book and no real store touched, and the saved `lastOpenBook`
pointer read before and restored after.

What the 409 branch renders: 「這本書的內容沒有儲存成功，無法閱讀。刪除後重新上傳即可。」 in
`danger`, then 刪除這本書, then 返回書庫 — **and no 重新載入**, which is the distinction the
"try again, but not actually try" section above draws, now confirmed on screen rather than only
in jsdom. Centred, `maxW` 420px, and at 375 px wide (the target device) the message keeps its
`px={6}` margins with no horizontal overflow.

Both of its actions were exercised:

- **刪除這本書 with the delete succeeding** cleared the last-open pointer and landed on the
  Library.
- **刪除這本書 with the delete answering 502** left the message and both buttons on screen, on
  the same route, with nothing disabled — "a delete that itself fails leaves the message on
  screen rather than pretending it worked", which until now was a claim in a test.

Not a pixel screenshot: the browser pane was not compositing, so this is the accessibility tree
plus computed geometry and colour rather than an image. That is enough for the two things that
were actually in doubt — the 409 branch's wording, and its delete.

### Found while closing, and it belongs to ticket 17 rather than here

Not this ticket's, not fixed here, and worth someone's attention: `redisChunkIndex.readIndex`
hands `readIndexedRun` whatever `hgetall` returned, and `@upstash/redis` types that as
`TData | null` — Redis has no empty hash, so **a Book nobody has narrated yet returns `null`,
not `{}`**. `readIndexedRun` treats that as "no usable index" and both HLS routes answer 502.

That is the exact distinction
[ticket 17](../../phase-1-10-continuous-hls-playback/issues/17-a-generated-chunk-past-the-gap-reads-as-ungenerated.md)
was built to preserve, and its criterion says "a valid index must yield a run — even an
entirely empty one". Its tests use `indexed({})`, a truthy empty object, which is a shape the
real client cannot produce for a Book with nothing in it. Self-healing — the first generated
Chunk creates the hash — so what it costs is the manifest read on a newly uploaded Book, which
`useBookPlayer` logs and swallows. Recorded here because this is where it was found; it should
be its own ticket.

### Why this was worth its own ticket rather than a line in ticket 05

Ticket 05's defect was one missing header on one code path. This one is a property of how the
Library's write path and read path handle failure, and it will outlive the R2 migration
entirely — the same three layers behaved the same way when the store was Vercel Blob. Fixing
the `411` removed the trigger that happened to be in front of us, not the mechanism.
