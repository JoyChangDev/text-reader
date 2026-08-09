import { isPlayableChunk } from './chunkAudio';
import { createEdgeTtsClient } from './edgeTtsClient';
import { measureMp3Duration } from './mp3Frames';
import { createObjectStorageClient } from './objectStorageClient';
import { createChunkIndexClient } from './redisChunkIndex';
import { deriveCueSpans } from './sentenceSpans';

function cacheKey({ bookId, chunkIndex, voice }) {
  return `${bookId}/${chunkIndex}/${voice}`;
}

// Chunks cached before ticket 02 added durationSeconds are repaired in place by re-measuring
// the stored MP3: cheaper and more faithful than resynthesizing (edge-tts isn't guaranteed to
// reproduce identical bytes), and it leaves the cached audio untouched. A missing or
// unmeasurable blob returns undefined rather than persisting a zero — a stored zero would be
// permanent and would silently become #EXTINF:0 — and the caller regenerates the Chunk instead.
async function repairCachedDuration(storageClient, key, cached) {
  const audioBytes = await storageClient.getAudioBytes(key);
  const durationSeconds = audioBytes ? measureMp3Duration(audioBytes) : 0;
  if (durationSeconds <= 0) {
    return undefined;
  }

  const repaired = { ...cached, durationSeconds };
  await storageClient.putJson(key, repaired);
  return repaired;
}

// Records a Chunk in the index the HLS routes read, so their cost stops being one Blob read
// per Chunk (see ticket 08's stage 2). Every path that ends with playable audio goes through
// this, including a plain cache hit: nothing else ever writes the index, so a Book generated
// before it existed - or one whose index was evicted - is re-indexed only by the Listener
// reading through it again. That is what makes "an unavailable Redis degrades to a rebuild"
// true rather than aspirational.
//
// Awaited rather than left in flight. The client generates a Chunk and then the playlist is
// polled for it; an index still one Chunk short reads as a hit, not a miss, so nothing would
// fall back to Blob to correct it and the Chunk would simply be absent until the next poll.
// The write is swallow-on-failure inside the client, so awaiting it cannot fail generation.
async function indexChunk(chunkIndexClient, { bookId, chunkIndex, voice, text }, metadata) {
  await chunkIndexClient.writeChunk(
    { bookId, chunkIndex, voice },
    {
      durationSeconds: metadata.durationSeconds,
      // Derived here, once, instead of on every manifest request over every placed Chunk.
      spans: deriveCueSpans({ text, boundaries: metadata.boundaries ?? [] }),
    },
  );

  return metadata;
}

// The one seam between the app and its two external dependencies (edge-tts, object
// storage) — see .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
// storageClient and ttsClient are passed in rather than imported, so tests can substitute
// fakes here instead of hitting the network or a real storage bucket. chunkIndexClient
// defaults to a disabled one so a caller that predates the index still generates audio.
export async function getOrGenerateAudio(
  { storageClient, ttsClient, chunkIndexClient = defaultChunkIndexClient },
  { bookId, chunkIndex, voice, text },
) {
  const key = cacheKey({ bookId, chunkIndex, voice });
  const chunk = { bookId, chunkIndex, voice, text };

  const cached = await storageClient.get(key);
  // Playable rather than merely present, so a Chunk cached before durationSeconds existed
  // and one whose stored duration is unusable take the same repair path instead of the
  // second kind reaching playlist generation.
  if (isPlayableChunk(cached)) {
    return indexChunk(chunkIndexClient, chunk, cached);
  }

  if (cached) {
    const repaired = await repairCachedDuration(storageClient, key, cached);
    if (repaired) {
      return indexChunk(chunkIndexClient, chunk, repaired);
    }
    // Falls through: the cached audio is missing or unmeasurable, so the entry can't back a
    // playlist entry and regenerating overwrites both blobs.
  }

  const generated = await ttsClient.synthesize(text, voice);
  const durationSeconds = measureMp3Duration(await generated.audio.arrayBuffer());
  const persisted = await storageClient.put(key, { ...generated, durationSeconds });

  return indexChunk(chunkIndexClient, chunk, persisted);
}

// How many Chunks are read per round trip. Wide enough that the look-ahead window
// (LOOKAHEAD = 10 in useBookPlayer) is normally covered in one, narrow enough that a
// burst never looks to the Blob store like abnormal traffic — see ticket 08, where an
// unbounded fan-out got the store's firewall to 403 every public read for half an hour.
const READ_BATCH = 16;

// The read-only bulk counterpart to getOrGenerateAudio, for the playlist and manifest
// routes: what a (Book, voice) already has, one entry per Chunk index and undefined where
// that Chunk isn't cached. It never synthesizes and never repairs — /api/audio-chunks
// stays the only thing that calls edge-tts (see ticket 03).
//
// It reads forward from `from` in batches and stops at the first Chunk that isn't there.
// Everything past that gap is read for nothing: the playlist truncates at it and the
// manifest follows, so a Chunk beyond it has no place on the timeline however complete
// its own audio is. The cost is therefore the length of the generated run, not the length
// of the Book — the difference between 12 reads and 1,983 on a real Book. A Chunk past
// the gap comes back undefined because this never looked, which is the same conclusion
// the playlist reaches about it anyway.
//
// `from` is the Chunk the caller's playlist starts at (see ticket 07). The scan has to
// honour it, or a Listener who jumped over an ungenerated stretch would get an empty
// playlist: the scan would stop at the gap they already jumped past.
export async function readCachedChunks({ storageClient }, { bookId, voice, chunkCount, from = 0 }) {
  const chunks = new Array(chunkCount).fill(undefined);

  for (let start = from; start < chunkCount; start += READ_BATCH) {
    const end = Math.min(start + READ_BATCH, chunkCount);
    const batch = await Promise.all(
      Array.from({ length: end - start }, (_, offset) =>
        storageClient.get(cacheKey({ bookId, chunkIndex: start + offset, voice })),
      ),
    );

    const gap = batch.findIndex((metadata) => !isPlayableChunk(metadata));
    batch.slice(0, gap === -1 ? batch.length : gap).forEach((metadata, offset) => {
      chunks[start + offset] = metadata;
    });

    if (gap !== -1) break;
  }

  return chunks;
}

// With no credentials configured this is a client whose reads miss and whose writes drop,
// which is what a fresh clone and the test suite both want: the app still plays, at the
// stage 1 Blob-scan cost.
const defaultChunkIndexClient = createChunkIndexClient();

const defaultClients = {
  storageClient: createObjectStorageClient(),
  ttsClient: createEdgeTtsClient(),
  chunkIndexClient: defaultChunkIndexClient,
};

// The public entry point for the rest of the app (API routes, future UI code): callers
// depend on this, never on blobStorageClient/edgeTtsClient directly, so edge-tts and
// object storage stay this module's private implementation detail. voice is supplied by
// the caller (the Listener's selection - see ticket 02) rather than hardcoded here.
export function generateAudioForChunk({ bookId, chunkIndex, text, voice }) {
  return getOrGenerateAudio(defaultClients, { bookId, chunkIndex, voice, text });
}

export function getCachedChunks({ bookId, voice, chunkCount, from }) {
  return readCachedChunks(defaultClients, { bookId, voice, chunkCount, from });
}
