import { createBlobStorageClient } from './blobStorageClient';
import { createEdgeTtsClient } from './edgeTtsClient';
import { measureMp3Duration } from './mp3Frames';

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

// The one seam between the app and its two external dependencies (edge-tts, object
// storage) — see .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
// storageClient and ttsClient are passed in rather than imported, so tests can substitute
// fakes here instead of hitting the network or a real storage bucket.
export async function getOrGenerateAudio(
  { storageClient, ttsClient },
  { bookId, chunkIndex, voice, text },
) {
  const key = cacheKey({ bookId, chunkIndex, voice });

  const cached = await storageClient.get(key);
  // > 0 rather than !== undefined, so a Chunk cached before durationSeconds existed and one
  // whose stored duration is unusable take the same repair path instead of the second kind
  // reaching playlist generation.
  if (cached?.durationSeconds > 0) {
    return cached;
  }

  if (cached) {
    const repaired = await repairCachedDuration(storageClient, key, cached);
    if (repaired) {
      return repaired;
    }
    // Falls through: the cached audio is missing or unmeasurable, so the entry can't back a
    // playlist entry and regenerating overwrites both blobs.
  }

  const generated = await ttsClient.synthesize(text, voice);
  const durationSeconds = measureMp3Duration(await generated.audio.arrayBuffer());
  return storageClient.put(key, { ...generated, durationSeconds });
}

const defaultClients = {
  storageClient: createBlobStorageClient(),
  ttsClient: createEdgeTtsClient(),
};

// The public entry point for the rest of the app (API routes, future UI code): callers
// depend on this, never on blobStorageClient/edgeTtsClient directly, so edge-tts and
// object storage stay this module's private implementation detail. voice is supplied by
// the caller (the Listener's selection - see ticket 02) rather than hardcoded here.
export function generateAudioForChunk({ bookId, chunkIndex, text, voice }) {
  return getOrGenerateAudio(defaultClients, { bookId, chunkIndex, voice, text });
}
