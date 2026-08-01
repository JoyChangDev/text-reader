# 06 — Loading state for book transitions

**What to build:** Visible loading feedback for the two gaps that currently have none: `BookUploader` while `/api/chunks` processes an uploaded file, and `/book/[bookId]` while `getBook` fetches the book's chunks/resume position before `AudioPlayer` can render. Both currently go silent during their async gap, which can read as the app being frozen or broken.

**Blocked by:** 01 (the `/book/[bookId]` half needs the new route to exist)

**Status:** ready-for-agent

- [ ] `BookUploader` shows a loading indicator (and disables the file picker button) for the duration of the `/api/chunks` fetch in `processFile`, instead of leaving the dropzone static with no feedback.
- [ ] `/book/[bookId]` shows a loading state while `getBook` is in flight, before `AudioPlayer` mounts — evaluate whether this Next.js version's `loading.tsx` file convention (see `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`) is a better fit than local component state for a dynamic route, and use whichever fits this codebase's existing patterns better.
- [ ] Both loading states are covered by tests asserting the indicator is present during the pending fetch and gone once content renders.
- [ ] Manually verified: uploading a file and opening a book from the library both show clear loading feedback instead of an apparent freeze.

## Comments
