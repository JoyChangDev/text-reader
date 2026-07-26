const STORAGE_KEY = 'text-reader:library';

// The library (list of uploaded books, each with its resume chunk index) is
// persisted in the browser's local storage, scoped per device - see
// .scratch/phase-1-audiobook-reader/issues/07-local-library-resume.md. This is
// the one public interface the rest of the app depends on; nothing else should
// read or write the raw storage key/shape directly.
function readLibrary() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLibrary(library) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function addBook({ bookId, title, chunks }) {
  const library = readLibrary();
  library.push({ bookId, title, chunks, resumeIndex: 0 });
  writeLibrary(library);
}

export function listBooks() {
  return readLibrary();
}

export function getBook(bookId) {
  return readLibrary().find((book) => book.bookId === bookId) ?? null;
}

export function updateResumeIndex(bookId, resumeIndex) {
  const library = readLibrary();
  writeLibrary(library.map((book) => (book.bookId === bookId ? { ...book, resumeIndex } : book)));
}
