import { createBlobStorageClient } from './blobStorageClient';
import { createEdgeTtsClient } from './edgeTtsClient';

// The one fixed, hardcoded default zh-TW voice for all generation in Phase 1 — see
// .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
const DEFAULT_VOICE = 'zh-TW-HsiaoChenNeural';

function cacheKey({ bookId, chunkIndex, voice }) {
  return `${bookId}/${chunkIndex}/${voice}`;
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
  if (cached) {
    return cached;
  }

  const generated = await ttsClient.synthesize(text, voice);
  return storageClient.put(key, generated);
}

const defaultClients = {
  storageClient: createBlobStorageClient(),
  ttsClient: createEdgeTtsClient(),
};

// The public entry point for the rest of the app (API routes, future UI code): callers
// depend on this, never on blobStorageClient/edgeTtsClient directly, so edge-tts and
// object storage stay this module's private implementation detail.
export function generateAudioForChunk({ bookId, chunkIndex, text }) {
  return getOrGenerateAudio(defaultClients, { bookId, chunkIndex, voice: DEFAULT_VOICE, text });
}
