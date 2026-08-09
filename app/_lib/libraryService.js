import { splitIntoSentences } from './chunkText';
import { createObjectStorageClient } from './objectStorageClient';
import { createResumePositionClient } from './redisResumePosition';

const INDEX_KEY = 'library/index';
const chunksKey = (bookId) => `library/${bookId}/chunks`;
// The resume position's durable snapshot. Deliberately its own blob rather than a field
// on the index: the index is rewritten wholesale by addBook and deleteBook, so anything
// sharing it is in a read-modify-write race with them. See ticket 10.
const resumeSnapshotKey = (bookId) => `library/${bookId}/resume`;

async function readIndex(storageClient) {
  return (await storageClient.get(INDEX_KEY)) ?? [];
}

const NO_POSITION = { resumeIndex: 0, resumeSentenceIndex: 0 };

// Where a Book is resumed from, in order of authority. Redis holds the live value; the
// snapshot is at most one session behind it; and `summary` is where positions lived before
// ticket 10 split them out, kept so Books read before that change don't reset to the start.
function withPosition(summary, position) {
  const { resumeIndex, resumeSentenceIndex } = position ?? legacyPosition(summary) ?? NO_POSITION;
  return { ...summary, resumeIndex, resumeSentenceIndex };
}

function legacyPosition(summary) {
  return typeof summary?.resumeIndex === 'number' ? summary : undefined;
}

const defaultClients = {
  storageClient: createObjectStorageClient(),
  positionClient: createResumePositionClient(),
};

// The server-side Library store (parallel to audioGenerationService.js): a compact
// library/index.json summary list (bookId/title/totalChunks, cheap to read on every
// list) plus a per-book library/<bookId>/chunks.json blob (the full Chunk text, read only
// when a Book is opened) - see
// .scratch/phase-1-6-listening-polish/issues/07-cross-device-library.md. The reading
// position is no longer in either of those; see ticket 10 and resumeSnapshotKey above.
// storageClient and positionClient are injected (defaulting to the real ones) so tests can
// substitute fakes, same pattern audioGenerationService.js already establishes.
export async function listBooks({ storageClient, positionClient } = defaultClients) {
  const index = await readIndex(storageClient);
  // One call for every Book's position rather than one read per Book - the shape of bug
  // tickets 08 through 10 are all about.
  const positions = await positionClient.readAll();

  // `{}` means Redis answered and simply holds nothing for these Books - the normal state
  // right after ticket 10 landed - so each falls through to the field left on its summary,
  // which costs nothing extra. Only `undefined`, meaning Redis could not answer at all, is
  // worth a snapshot read per Book: a Book added after ticket 10 has no field on its
  // summary, so without this its progress would read as 0% for the whole outage.
  if (positions) {
    return index.map((summary) => withPosition(summary, positions[summary.bookId]));
  }

  return Promise.all(
    index.map(async (summary) =>
      withPosition(summary, await storageClient.get(resumeSnapshotKey(summary.bookId))),
    ),
  );
}

export async function addBook(
  { bookId, title, chunks },
  { storageClient, positionClient } = defaultClients,
) {
  const index = await readIndex(storageClient);
  // totalChunks is cheap to record here (chunks.length is already in hand at upload
  // time) and lets the library list show real per-book progress without reading each
  // book's full chunks blob - see BookLibrary.jsx. sentenceCountsByChunk is computed the
  // same way here, via the same splitIntoSentences helper TranscriptView uses for
  // rendering, so the Sentence-level percentage (see bookProgress.js) never needs to
  // re-read a book's full chunk text later either (see ticket 04).
  //
  // No resume position: a new Book has none, and absence already means the start. Writing
  // a zero here would put the counter back in the document ticket 10 took it out of.
  const sentenceCountsByChunk = chunks.map((chunk) => splitIntoSentences(chunk).length);
  const summary = {
    bookId,
    title,
    totalChunks: chunks.length,
    sentenceCountsByChunk,
  };

  await storageClient.putJson(INDEX_KEY, [...index, summary]);
  await storageClient.putJson(chunksKey(bookId), chunks);

  // No position lookup: bookId is a freshly generated uuid, so a read could only miss.
  return withPosition(summary, undefined);
}

export async function getBook(bookId, { storageClient, positionClient } = defaultClients) {
  const index = await readIndex(storageClient);
  const summary = index.find((book) => book.bookId === bookId);
  if (!summary) return null;

  const chunks = (await storageClient.get(chunksKey(bookId))) ?? [];
  // This is the read that decides where playback resumes, so unlike listBooks it pays for
  // the snapshot when Redis has nothing - one extra Blob read when a Book is opened,
  // against silently restarting a Book the Listener was halfway through.
  const position =
    (await positionClient.read(bookId)) ?? (await storageClient.get(resumeSnapshotKey(bookId)));

  return { ...withPosition(summary, position), chunks };
}

// Resume position is always saved as one atomic (Chunk, Sentence) pair - never two
// separate writes that could disagree (see ticket 05).
//
// It no longer touches the index at all. `updatedAt` says when the position changed on the
// client, and a save only wins if it is newer than what is stored - which is what stops an
// hour-old position flushed by a device that was offline from overwriting a newer one (see
// ticket 10). `snapshot` is the caller telling us this is one of the flush points, and is
// the only thing that costs a Blob operation.
//
// There is no "book not found" check: proving the Book exists means reading the index,
// which is the exact operation this path exists to stop spending. A position stored for a
// Book that isn't there is unreachable and costs nothing.
export async function updateResumeIndex(
  bookId,
  { resumeIndex, resumeSentenceIndex, updatedAt, snapshot = false },
  { storageClient, positionClient } = defaultClients,
) {
  const position = { resumeIndex, resumeSentenceIndex, updatedAt };
  const won = await positionClient.write(bookId, position);

  // Skipped only when Redis positively said a newer position exists - `undefined` means
  // Redis could not be reached, and that is exactly when the snapshot matters most.
  if (snapshot && won !== false) {
    await writeSnapshot(storageClient, bookId, position, { unverified: won === undefined });
  }

  return position;
}

// When Redis returned a verdict it has already rejected anything stale, so the snapshot
// just follows it. When it could not be reached there is no verdict, and writing blindly
// would let a device that had been offline overwrite a newer snapshot simply by flushing
// last - the very failure the Redis comparison exists to prevent. So that path, and only
// that path, pays one Blob read to compare first: it happens at a flush point during a
// Redis outage, which is rare enough to afford it and important enough to want it.
async function writeSnapshot(storageClient, bookId, position, { unverified }) {
  const key = resumeSnapshotKey(bookId);
  if (unverified) {
    const stored = await storageClient.get(key);
    if (stored && stored.updatedAt >= position.updatedAt) return;
  }

  await storageClient.putJson(key, position);
}

// Cascade delete: drops the book from the index, its chunks and progress blobs, its stored
// resume position, and every audio/metadata blob audioGenerationService.js cached under
// `${bookId}/${chunkIndex}/${voice}` (see
// .scratch/phase-1-6-listening-polish/issues/08-delete-book-cascade-blob-cleanup.md). list()
// is scoped to the bookId prefix, so this never touches other books' or the library
// index's own blobs.
export async function deleteBook(bookId, { storageClient, positionClient } = defaultClients) {
  const index = await readIndex(storageClient);
  if (!index.some((book) => book.bookId === bookId)) return null;

  const updatedIndex = index.filter((book) => book.bookId !== bookId);
  await storageClient.putJson(INDEX_KEY, updatedIndex);
  await storageClient.del(`${chunksKey(bookId)}.json`);
  await storageClient.del(`${resumeSnapshotKey(bookId)}.json`);
  await positionClient.remove(bookId);

  const audioBlobs = await storageClient.list(`${bookId}/`);
  await Promise.all(audioBlobs.map(({ pathname }) => storageClient.del(pathname)));

  return { bookId };
}
