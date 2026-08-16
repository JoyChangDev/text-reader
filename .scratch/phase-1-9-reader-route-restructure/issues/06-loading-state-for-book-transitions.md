# 06 — Loading state for book transitions

**What to build:** Visible loading feedback for the two gaps that currently have none: `BookUploader` while `/api/chunks` processes an uploaded file, and `/book/[bookId]` while `getBook` fetches the book's chunks/resume position before `AudioPlayer` can render. Both currently go silent during their async gap, which can read as the app being frozen or broken.

**Blocked by:** 01 (the `/book/[bookId]` half needs the new route to exist)

**Status:** resolved — verified on the device 2026-08-16. Uploading showed 處理中… for the whole wait and then went straight into the new Book; opening a Book from the Library showed the spinner immediately, with no dead interval first. Two places where the implementation and this ticket's wording differ are recorded in "What the device check found" — both are the implementation being wider than the criterion, not narrower.

- [x] `BookUploader` shows a loading indicator (and disables the file picker button) for the duration of the `/api/chunks` fetch in `processFile`, instead of leaving the dropzone static with no feedback.
- [x] `/book/[bookId]` shows a loading state while `getBook` is in flight, before `AudioPlayer` mounts — evaluated `loading.tsx` and decided against it: that convention only covers the Suspense boundary around a server-rendered Page's initial render, but `BookPage` is a Client Component fetching in a `useEffect`, so `loading.tsx` would never actually cover this gap. Local component state (a `Spinner`, already added in ticket 01) is the only mechanism that can.
- [x] Both loading states are covered by tests asserting the indicator is present during the pending fetch and gone once content renders.
- [x] Manually verified: uploading a file and opening a book from the library both show clear loading feedback instead of an apparent freeze. Verified 2026-08-16 on the device — the upload showed 處理中… and then entered the new Book on its own; tapping a Book showed the spinner immediately.

## Comments

### What the device check found

Both halves passed. Before the device run, both states were also driven in a browser against the
real dev server with the two requests artificially delayed, which is what made it worth checking
the wording as well as the behaviour: the states were known to render, so the only open question
on the device was the one this criterion actually asks — whether the wait _reads_ as the app
working rather than as the app frozen.

**The file picker button is replaced, not disabled.** The criterion says "disables the file picker
button". `BookUploader` swaps the `選擇檔案` button out for `⟳ 處理中…` entirely, and disables the
hidden `<input>` behind it. Unclickable either way, and a control that is gone says "busy" more
plainly than a greyed-out one, but it is not what the criterion describes and a later reader
comparing the two would otherwise have to work out which was wrong.

**The upload's loading state covers more than the criterion asks for.** It says "for the duration
of the `/api/chunks` fetch". `isProcessing` is cleared in a `finally` that also waits on
`onReady`, so it spans chunking _and_ the `addBook` write _and_ the navigation into the new Book —
the whole gap, rather than the first third of it. That is why the device run showed one continuous
`處理中…` and then the reader, with no second unexplained pause between them. Wider than asked,
and deliberately so.

**Confirmed in passing: [ticket 06 of phase 1.11](../../phase-1-11-object-storage-migration/issues/06-a-failed-write-reads-as-an-empty-book.md).**
With `POST /api/library` forced to 502 in the browser harness, the uploader surfaced its visible
error and stayed on `/` instead of navigating into a Book that was never stored. That is the
behaviour that ticket built, observed from the outside rather than from its own tests.
