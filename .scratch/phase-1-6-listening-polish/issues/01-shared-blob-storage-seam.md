# 01 — Shared Blob storage seam (`del`/`list`)

**What to build:** Extend the one existing seam between the app and Vercel Blob so every
later ticket that needs to delete or enumerate blobs (Library storage, cleanup sweep,
pronunciation reports) can inject a fake client in tests instead of hitting real storage,
exactly like `audioGenerationService.js` already does for `get`/`put`.

**Blocked by:** None — can start immediately

**Status:** done

- [x] `blobStorageClient.js` exposes `del(key)`, wrapping `@vercel/blob`'s `del`
- [x] `blobStorageClient.js` exposes `list(prefix)`, wrapping `@vercel/blob`'s `list`,
      returning each blob's pathname, size, and `uploadedAt`
- [x] Both are covered by unit tests against a faked underlying `@vercel/blob` module — no
      test hits real network/storage
- [x] No existing `get`/`put` behavior or call sites change

## Comments
