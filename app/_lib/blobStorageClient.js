import { del, get, list, put } from '@vercel/blob';

const metadataPathname = (key) => `${key}.json`;
const audioPathname = (key) => `${key}.mp3`;

// Wraps Vercel Blob — the only file that imports @vercel/blob. See
// .scratch/phase-1-audiobook-reader/issues/04-audio-generation-service.md.
// Audio and its boundary metadata are stored as two blobs under a deterministic,
// non-random pathname derived from the cache key so a later `get` can find them again.
export function createBlobStorageClient({ token } = {}) {
  function putOptions(contentType) {
    return { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, token };
  }

  return {
    async get(key) {
      // @vercel/blob's get() resolves null on a 404 rather than throwing.
      const result = await get(metadataPathname(key), { access: 'public', token });
      if (!result) {
        return undefined;
      }

      const metadataText = await new Response(result.stream).text();
      return JSON.parse(metadataText);
    },

    async put(key, { audio, boundaries, durationSeconds }) {
      const audioBlob = await put(audioPathname(key), audio, putOptions('audio/mpeg'));
      const persisted = { url: audioBlob.url, boundaries, durationSeconds };

      await put(metadataPathname(key), JSON.stringify(persisted), putOptions('application/json'));

      return persisted;
    },

    // Reads back the raw MP3 bytes already stored under key, for the lazy-remeasurement
    // path in audioGenerationService.js — a cache hit predating durationSeconds needs
    // the original audio to measure without resynthesizing it.
    async getAudioBytes(key) {
      const result = await get(audioPathname(key), { access: 'public', token });
      if (!result) {
        return undefined;
      }

      return new Response(result.stream).arrayBuffer();
    },

    // A generic counterpart to get() for callers that only need to persist plain JSON
    // under a key (e.g. libraryService.js's index/chunks blobs) rather than the
    // audio+boundaries pair get/put above are specifically shaped for.
    async putJson(key, data) {
      await put(metadataPathname(key), JSON.stringify(data), putOptions('application/json'));
    },

    // Unlike get/put's key (a cache key mapped through metadataPathname/audioPathname),
    // del/list operate on literal blob pathnames, e.g. as returned by list() itself.
    async del(pathname) {
      await del(pathname, { token });
    },

    async list(prefix) {
      const { blobs } = await list({ prefix, token });
      return blobs.map(({ pathname, size, uploadedAt }) => ({ pathname, size, uploadedAt }));
    },
  };
}
