import { createBlobStorageClient } from './blobStorageClient';

const INDEX_KEY = 'library/index';
const chunksKey = (bookId) => `library/${bookId}/chunks`;

async function readIndex(storageClient) {
  return (await storageClient.get(INDEX_KEY)) ?? [];
}

const defaultClients = { storageClient: createBlobStorageClient() };

// The server-side Library store (parallel to audioGenerationService.js): a compact
// library/index.json summary list (bookId/title/resumeIndex, cheap to read on every
// list/resume-index update) plus a per-book library/<bookId>/chunks.json blob (the full
// Chunk text, read only when a Book is opened) - see
// .scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md. storageClient is
// injected (defaulting to the real Blob-backed client) so tests can substitute a fake one,
// same pattern audioGenerationService.js already establishes.
export async function listBooks({ storageClient } = defaultClients) {
  return readIndex(storageClient);
}

export async function addBook({ bookId, title, chunks }, { storageClient } = defaultClients) {
  const index = await readIndex(storageClient);
  // totalChunks is cheap to record here (chunks.length is already in hand at upload
  // time) and lets the library list show real per-book progress without reading each
  // book's full chunks blob - see BookLibrary.jsx.
  const summary = { bookId, title, resumeIndex: 0, totalChunks: chunks.length };

  await storageClient.putJson(INDEX_KEY, [...index, summary]);
  await storageClient.putJson(chunksKey(bookId), chunks);

  return summary;
}

export async function getBook(bookId, { storageClient } = defaultClients) {
  const index = await readIndex(storageClient);
  const summary = index.find((book) => book.bookId === bookId);
  if (!summary) return null;

  const chunks = (await storageClient.get(chunksKey(bookId))) ?? [];
  return { ...summary, chunks };
}

export async function updateResumeIndex(bookId, resumeIndex, { storageClient } = defaultClients) {
  const index = await readIndex(storageClient);
  if (!index.some((book) => book.bookId === bookId)) return null;

  const updatedIndex = index.map((book) =>
    book.bookId === bookId ? { ...book, resumeIndex } : book,
  );
  await storageClient.putJson(INDEX_KEY, updatedIndex);

  return updatedIndex.find((book) => book.bookId === bookId);
}

// Cascade delete: drops the book from the index, its chunks blob, and every audio/metadata
// blob audioGenerationService.js cached under `${bookId}/${chunkIndex}/${voice}` (see
// .scratch/phase-1-6-listening-polish/issues/08-delete-book-cascade-blob-cleanup.md). list()
// is scoped to the bookId prefix, so this never touches other books' or the library
// index's own blobs.
export async function deleteBook(bookId, { storageClient } = defaultClients) {
  const index = await readIndex(storageClient);
  if (!index.some((book) => book.bookId === bookId)) return null;

  const updatedIndex = index.filter((book) => book.bookId !== bookId);
  await storageClient.putJson(INDEX_KEY, updatedIndex);
  await storageClient.del(`${chunksKey(bookId)}.json`);

  const audioBlobs = await storageClient.list(`${bookId}/`);
  await Promise.all(audioBlobs.map(({ pathname }) => storageClient.del(pathname)));

  return { bookId };
}
