const BASE_URL = '/api/library';

// What /api/library/[bookId] answers for a Book the index advertises but whose text was
// never stored (see libraryService.js's BOOK_INCOMPLETE). Named here so the reader route can
// tell that permanent, Listener-actionable corruption from a store that is merely down.
export const INCOMPLETE_BOOK_STATUS = 409;

// Every route behind this module answers a failure with a JSON body - `{ error: '...' }` -
// so a response that is merely parsed is indistinguishable from a real answer: a 502 from
// POST /api/library used to come back from addBook as an object that simply was not a Book,
// and the upload reported success and navigated into it (see ticket 06). The status is
// carried on the error because callers act on it: 404 is an answer, 409 is a corrupt Book,
// and anything else is the store or the network.
async function readJsonOrThrow(response) {
  if (!response.ok) {
    const error = new Error(`The library request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

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

  return readJsonOrThrow(response);
}

export async function listBooks() {
  const response = await fetch(BASE_URL);
  const { books } = await readJsonOrThrow(response);
  return books;
}

// 404 is the one status that is an answer rather than a failure: "there is no such Book" is
// what the reader route acts on to clear a stale pointer and fall back to the Library. Every
// other non-2xx reaches the caller as a rejection - including the 409 that says the Book is
// listed but its text was never stored, which the reader has to be able to say out loud.
export async function getBook(bookId) {
  const response = await fetch(`${BASE_URL}/${bookId}`);
  if (response.status === 404) return null;

  return readJsonOrThrow(response);
}

// `updatedAt` is stamped by the caller, not here and not by the server: it has to say when
// the position changed on this device, so that a device coming back from being offline
// cannot overwrite a newer position simply by arriving last (see ticket 10). `snapshot`
// asks the server to also write the durable copy, and belongs only to the flush points.
export async function updateResumeIndex(
  bookId,
  { resumeIndex, resumeSentenceIndex, updatedAt, snapshot = false },
) {
  const response = await fetch(`${BASE_URL}/${bookId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeIndex, resumeSentenceIndex, updatedAt, snapshot }),
  });

  return readJsonOrThrow(response);
}

export async function deleteBook(bookId) {
  const response = await fetch(`${BASE_URL}/${bookId}`, { method: 'DELETE' });
  if (response.status === 404) return null;

  return readJsonOrThrow(response);
}
