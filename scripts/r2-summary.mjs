// The pure half of scripts/inspect-r2.mjs: turns a ListObjectsV2 listing into the figures
// .scratch/phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md's remaining
// criteria are measured with. Separated from the CLI for the same reason listObjectsXml.js is
// separated from objectStorageClient.js — it knows nothing about requests or credentials, so
// it can be tested without either.
//
// Objects, not the dashboard counter. R2's metrics are an aggregate that lags: the first
// measurement read 78 before a run and 78 after, while the bucket had demonstrably gained 40
// objects. Each object carries its own write time, which is what makes a count attributable to
// a run rather than to a day.

// One group per Book, since every audio key is `<bookId>/<chunkIndex>/<voice>.(mp3|json)` and
// the Library's own blobs all sit under `library/`. A key at the root belongs to neither, and
// is worth seeing precisely because nothing accounts for it.
const ROOT_GROUP = '(root)';

function groupOf(pathname) {
  const separator = pathname.indexOf('/');
  return separator === -1 ? ROOT_GROUP : pathname.slice(0, separator + 1);
}

// listObjectsXml.js reports a record whose `LastModified` it could not read rather than
// dropping it, so a group's window has to be built from the dated objects alone. An undated
// one still counts towards the group — it occupies the bucket either way — it just cannot be
// attributed to a moment.
function widen({ firstWrite, lastWrite }, uploadedAt) {
  if (!uploadedAt) return { firstWrite, lastWrite };

  return {
    firstWrite: !firstWrite || uploadedAt < firstWrite ? uploadedAt : firstWrite,
    lastWrite: !lastWrite || uploadedAt > lastWrite ? uploadedAt : lastWrite,
  };
}

// `since` is a moment, so an object with no write time is not after it — the same objects that
// cannot be attributed to a window cannot be attributed to a run.
function writtenSince(uploadedAt, since) {
  return Boolean(uploadedAt) && Date.parse(uploadedAt) >= Date.parse(since);
}

export function summariseObjects(objects, { since } = {}) {
  const groups = new Map();
  let bytes = 0;
  let sinceCount = 0;
  let sinceBytes = 0;

  for (const { pathname, size, uploadedAt } of objects) {
    const prefix = groupOf(pathname);
    const group = groups.get(prefix) ?? { prefix, count: 0, bytes: 0 };

    groups.set(prefix, {
      ...group,
      count: group.count + 1,
      bytes: group.bytes + size,
      ...widen(group, uploadedAt),
    });

    bytes += size;

    if (since && writtenSince(uploadedAt, since)) {
      sinceCount += 1;
      sinceBytes += size;
    }
  }

  return {
    count: objects.length,
    bytes,
    // Largest first: the Book being measured is the reason this is being read, and an orphan
    // prefix nobody expected is easiest to spot against the one that dominates.
    groups: [...groups.values()].sort(
      (a, b) => b.bytes - a.bytes || a.prefix.localeCompare(b.prefix),
    ),
    since: since ? { count: sinceCount, bytes: sinceBytes } : undefined,
  };
}

// Which Chunks of one Book already have narrated audio, from a listing of that Book's prefix.
// Keyed off the `.mp3` rather than the metadata JSON beside it, because the pair is written
// together and counting both would report every Chunk twice.
//
// The voice matters: audio is stored per (Chunk, voice), so a Chunk narrated in one voice is
// genuinely ungenerated in another. Treating it as generated would exclude it from a
// measurement range it belongs in.
const CHUNK_AUDIO = /^[^/]+\/(\d+)\/(.+)\.mp3$/;

export function generatedChunkIndexes(objects, voice) {
  const indexes = new Set();

  for (const { pathname } of objects) {
    const match = CHUNK_AUDIO.exec(pathname);
    if (match && match[2] === voice) indexes.add(Number(match[1]));
  }

  // Numerically. Sorting these as text would put 10 before 9, and the caller's next move is
  // to take the highest one and start a range past it.
  return [...indexes].sort((a, b) => a - b);
}

// Decimal units, because the quota these are read against is decimal: blobCleanupService.js
// bills against 10^10 for R2's 10 GB, so reporting GiB here would disagree with the capacity
// indicator over the same bucket. Bytes stay bytes below a kilobyte, where two decimal places
// would round the Library index to 0.00 KB.
const UNITS = [
  ['GB', 1_000_000_000],
  ['MB', 1_000_000],
  ['KB', 1_000],
];

export function formatBytes(bytes) {
  const unit = UNITS.find(([, scale]) => bytes >= scale);
  if (!unit) return `${bytes} B`;

  const [name, scale] = unit;
  return `${(bytes / scale).toFixed(2)} ${name}`;
}
