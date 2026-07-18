import { get, put } from '@vercel/blob';

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

    async put(key, { audio, boundaries }) {
      const audioBlob = await put(audioPathname(key), audio, putOptions('audio/mpeg'));
      const persisted = { url: audioBlob.url, boundaries };

      await put(metadataPathname(key), JSON.stringify(persisted), putOptions('application/json'));

      return persisted;
    },
  };
}
