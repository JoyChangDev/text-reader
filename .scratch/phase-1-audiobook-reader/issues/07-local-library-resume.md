# 07 — Local library with resume position

**What to build:** Uploaded books are saved as entries in the browser's local storage, each tracking its own resume chunk index. A library view lists all previously uploaded books. Opening a book from the library resumes playback at its saved position, and any already-heard chunks play instantly from cache rather than regenerating.

**Blocked by:** 06 — Upload + progressive playback UI

**Status:** resolved

- [x] Uploading a `.txt` file adds a new entry to a persisted local library, without replacing any existing entries
- [x] A library view lists all previously uploaded books
- [x] Selecting a book from the library resumes playback at the chunk index it was last left at
- [x] Reloading the app preserves the library and each book's resume position across the reload
- [x] Replaying a chunk that was already generated earlier in the session plays instantly from cache, with no new `edge-tts` generation call

## Comments

Added `app/_lib/bookLibrary.js`: a small `localStorage`-backed module with exactly the public interface the spec's Testing Decisions call for — `addBook`, `listBooks`, `getBook`, `updateResumeIndex` — so tests exercise that interface rather than asserting on the raw storage key/shape. Each entry is `{ bookId, title, chunks, resumeIndex }`; `chunks` is stored alongside the entry so reopening a book from the library doesn't need the original uploaded text again, just the already-split chunk strings.

New `app/_components/BookLibrary.jsx` lists library entries (reads them in a mount effect, not a lazy `useState` initializer, so the first client render matches the server-rendered empty state before hydration - `next-themes`-style deferred read). `app/page.jsx` now renders both `BookUploader` and `BookLibrary` when no book is open; uploading calls `addBook` before handing off to `AudioPlayer`, and selecting a library entry calls `getBook` and passes its `resumeIndex` through as `initialIndex`.

`useBookPlayer` gained an `initialIndex` param (used as the `currentIndex` initial state) and a small effect that calls `updateResumeIndex(bookId, currentIndex)` whenever the current chunk changes, so the saved position always reflects the last chunk reached. No new client-side audio cache was added for the "replay from cache" criterion - it was already covered by the existing Audio Generation Service's storage-first cache (ticket 04) keyed on `(bookId, chunkIndex, voice)`, which persists across sessions since `bookId` itself is what's persisted in the library entry; and `chunkFetchPlan` never re-requests chunks behind the current index in the first place.

`/code-review` (Standards + Spec axes) surfaced one real gap: there was no way to get back to the library after opening a book, undermining the spec's "switch between several texts... without losing progress on any of them" story once more than one book existed. Added a "Back to library" button on `AudioPlayer` (`onBackToLibrary` prop, wired to `setBook(null)` in `page.jsx`) to close that gap. A couple of judgement-call smells were also flagged (persistence living inside `useBookPlayer` rather than a caller; the `{ bookId, chunks, initialIndex }` trio threaded through three layers) but left as-is - restructuring either would add more machinery than three call sites currently justify.

Tests added: `bookLibrary.test.js` (TDD'd first, pure interface tests), `BookLibrary.test.jsx`, plus extensions to `AudioPlayer.test.jsx` (resuming at a given `initialIndex` skips earlier chunks; `onBackToLibrary` wiring) and `page.test.jsx` (upload persists without clobbering existing entries, selecting a saved book resumes at its saved index without re-requesting earlier chunks, and back-to-library navigation lets the reader switch between two uploaded books in one session).
