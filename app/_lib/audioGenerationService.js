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
  await storageClient.put(key, generated);
  return generated;
}
