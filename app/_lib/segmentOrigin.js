// Where a Listener plays segments from — the segment Worker's origin, and the one value the
// write path and the read path have to agree about. See
// .scratch/phase-1-11-object-storage-migration/issues/04-segment-origin-becomes-configuration.md.
//
// It is configuration rather than something recovered from a write response, which supersedes
// ticket 08's decision. That decision held only while reads and writes shared a host: on R2
// the app writes to the S3 endpoint and the Listener reads from the Worker, so a write
// response cannot yield the origin a segment is played from. Nothing stores it either, so
// there is nothing left to go stale at a cutover.
//
// One module because two callers need the same answer and the same validation —
// objectStorageClient.js, to put a playable `url` into a Chunk's stored metadata, and
// redisChunkIndex.js, to give the playlist a base to derive segment URLs from. Two copies of
// this check would be two chances for the two of them to disagree about a shared value.

const SEGMENT_ORIGIN_ENV = 'SEGMENT_ORIGIN';

// Throws rather than returning undefined, and rejects a slashless origin rather than
// repairing it. Both failures are silent otherwise, and both are wrong in the same expensive
// way: `deriveSegmentUrl` concatenates, and `audioPathname` has no leading slash, so an
// origin missing its slash yields `…workers.devbook-1/0/voice.mp3` — a URL that 404s on every
// segment, from a store that is working perfectly. A repaired origin would be worse still,
// because a caller that skipped the repair would then build a different URL for the same
// object than one that did not.
export function requireSegmentOrigin(configured = process.env[SEGMENT_ORIGIN_ENV]) {
  if (!configured) {
    throw new Error(`The segment origin is not configured: set ${SEGMENT_ORIGIN_ENV}.`);
  }

  if (!configured.endsWith('/')) {
    throw new Error(
      `The segment origin is misconfigured: ${SEGMENT_ORIGIN_ENV} must end with a slash, got "${configured}".`,
    );
  }

  return configured;
}
