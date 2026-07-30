const BASE_URL = '/api/library';

// The library (list of uploaded books, each with its resume chunk index) is persisted
// server-side in Vercel Blob via /api/library, so a book uploaded on one device can be
// seen and resumed from any other - see
// .scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md. This is the one
// public interface the rest of the app depends on; nothing else should call these routes
// directly. Exported function names/shapes are unchanged from the previous
// localStorage-backed version, just now async.
export async function addBook({ bookId, title, chunks }) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, title, chunks }),
  });

  return response.json();
}

export async function listBooks() {
  const response = await fetch(BASE_URL);
  const { books } = await response.json();
  return books;
}

export async function getBook(bookId) {
  const response = await fetch(`${BASE_URL}/${bookId}`);
  if (!response.ok) return null;

  return response.json();
}

export async function updateResumeIndex(bookId, { resumeIndex, resumeSentenceIndex }) {
  const response = await fetch(`${BASE_URL}/${bookId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeIndex, resumeSentenceIndex }),
  });

  return response.json();
}

export async function deleteBook(bookId) {
  const response = await fetch(`${BASE_URL}/${bookId}`, { method: 'DELETE' });
  if (!response.ok) return null;

  return response.json();
}
