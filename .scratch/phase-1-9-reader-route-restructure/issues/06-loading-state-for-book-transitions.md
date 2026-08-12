# 06 — Loading state for book transitions

**What to build:** Visible loading feedback for the two gaps that currently have none: `BookUploader` while `/api/chunks` processes an uploaded file, and `/book/[bookId]` while `getBook` fetches the book's chunks/resume position before `AudioPlayer` can render. Both currently go silent during their async gap, which can read as the app being frozen or broken.

**Blocked by:** 01 (the `/book/[bookId]` half needs the new route to exist)

**Status:** ready-for-human — built and green. The one criterion left open needs Joy to verify it on the device; nothing here is waiting on an agent.

- [x] `BookUploader` shows a loading indicator (and disables the file picker button) for the duration of the `/api/chunks` fetch in `processFile`, instead of leaving the dropzone static with no feedback.
- [x] `/book/[bookId]` shows a loading state while `getBook` is in flight, before `AudioPlayer` mounts — evaluated `loading.tsx` and decided against it: that convention only covers the Suspense boundary around a server-rendered Page's initial render, but `BookPage` is a Client Component fetching in a `useEffect`, so `loading.tsx` would never actually cover this gap. Local component state (a `Spinner`, already added in ticket 01) is the only mechanism that can.
- [x] Both loading states are covered by tests asserting the indicator is present during the pending fetch and gone once content renders.
- [ ] Manually verified: uploading a file and opening a book from the library both show clear loading feedback instead of an apparent freeze. _(Needs Joy to verify on-device; not checkable from here.)_

## Comments
