import { createObjectStorageClient } from './objectStorageClient';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCLUDED_PREFIXES = ['library/', 'pronunciation-reports/'];

// R2's free tier includes 10 GB-month of storage as of writing - override via
// BLOB_QUOTA_BYTES if that changes. Cloudflare bills GB decimally, so this is 10^10 rather
// than the 1 GiB (2^30) Vercel Blob's Hobby plan allowed; leaving the old value would have
// the capacity indicator report against a tenth of the real store. The variable keeps its
// name, which is Vercel's - renaming it belongs to the separate naming ticket, along with
// the routes, the cron path and the usage component. See
// .scratch/phase-1-6-listening-polish/issues/09-automatic-manual-blob-cleanup.md and
// .scratch/phase-1-11-object-storage-migration/issues/04-segment-origin-becomes-configuration.md.
const DEFAULT_QUOTA_BYTES = 10_000_000_000;

function isChunkAudioPathname(pathname) {
  return !EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function quotaBytesFromEnv() {
  return Number(process.env.BLOB_QUOTA_BYTES) || DEFAULT_QUOTA_BYTES;
}

function sumBytes(blobs) {
  return blobs.reduce((total, blob) => total + blob.size, 0);
}

// Pure over list()'s output, so the daily cron, the "clean up now" button, and this
// module's own unit tests all run identical retention logic without touching a live
// storage client - see ticket 09. Scoped away from library/* and pronunciation-reports/*
// (never Chunk audio/metadata), which are cleaned up on their own terms (cascade delete,
// manual review) rather than by age.
export function planCleanup({ blobs, now, retentionDays = 7 }) {
  const cutoff = now.getTime() - retentionDays * MS_PER_DAY;

  return blobs
    .filter((blob) => isChunkAudioPathname(blob.pathname))
    .filter((blob) => new Date(blob.uploadedAt).getTime() <= cutoff)
    .map((blob) => blob.pathname);
}

export function computeUsagePercent({ blobs, quotaBytes }) {
  return (sumBytes(blobs) / quotaBytes) * 100;
}

const defaultClients = { storageClient: createObjectStorageClient() };

export async function getUsage(
  { storageClient } = defaultClients,
  { quotaBytes = quotaBytesFromEnv() } = {},
) {
  const blobs = await storageClient.list();
  const usedBytes = sumBytes(blobs);

  return { usedBytes, quotaBytes, percent: computeUsagePercent({ blobs, quotaBytes }) };
}

export async function cleanupBlobs(
  { storageClient } = defaultClients,
  { now = new Date(), retentionDays = 7 } = {},
) {
  const blobs = await storageClient.list();
  const pathnames = planCleanup({ blobs, now, retentionDays });

  await Promise.all(pathnames.map((pathname) => storageClient.del(pathname)));

  return { deleted: pathnames };
}
