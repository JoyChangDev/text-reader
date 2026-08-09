# 02 — Rewrite the storage client on R2, signing with aws4fetch

**What to build:** `objectStorageClient.js` — the same eight-method contract `blobStorageClient.js` exposes today, talking to R2's S3-compatible API over `aws4fetch` instead of `@vercel/blob`. `list()` is deferred to [ticket 03](03-list-objects-xml-parser.md).

**Blocked by:** —

**Status:** ready-for-agent

Not blocked by [ticket 01](01-r2-bucket-and-segment-worker.md): the tests mock `fetch`, so the whole of this ticket can be written and verified before a bucket exists. It cannot be _run_ against R2 until 01 lands, which is what [ticket 05](05-cut-over-and-measure.md) is for.

## Why aws4fetch rather than the AWS SDK

The storage client is imported transitively by the playlist route — `bookAudio` → `audioGenerationService` → the client — because the Blob scan is still the Chunk index's fallback. That route is re-fetched continuously by the media stack during playback, including while backgrounded. `@aws-sdk/client-s3` is megabytes and a few hundred milliseconds of cold start; putting that on the one path phases 1.8 through 1.10 were spent making reliable in the background is the wrong trade for a client that only ever does get, put, delete and list.

`aws4fetch` is about a kilobyte and signs plain `fetch` requests. Its cost is that `ListObjectsV2` comes back as XML — see ticket 03, and the precedent in `mp3Frames.js`, which walks MP3 frame headers by hand rather than taking on an audio library.

## The contract that must not change

Every consumer injects this client and is tested against a fake, so the whole point is that none of them notices. Keep the method names, arguments and return shapes exactly as they are, including the two conventions that are the client's own and invisible to callers: the `.json`/`.mp3` suffixing, and the fact that `del`/`list` take literal pathnames while `get`/`put` take cache keys.

**The one behaviour that does not port for free is a missing object.** `@vercel/blob`'s `get()` resolves `null` on a 404; the S3 API returns a 404 response that most clients surface as an error. `readCachedChunks`' "this Chunk isn't generated yet" branch, `libraryService`'s empty-index path and `getBook`'s snapshot fallback all depend on absence being `undefined` rather than a throw.

## Acceptance criteria

- [ ] `objectStorageClient.js` exports `createObjectStorageClient` with the same eight methods, arguments and return shapes as today's client.
- [ ] Credentials and the bucket/endpoint come from environment variables; nothing is hardcoded, and an absent configuration fails loudly at the seam rather than silently returning empty results.
- [ ] **A missing object resolves to `undefined` from `get` and `getAudioBytes`**, never throws.
- [ ] A non-404 error (403, 500, a network failure) still throws, so a broken store is not mistaken for an empty one.
- [ ] `put` returns the same `{ url, boundaries, durationSeconds }` shape, with `url` being the **playable** segment URL rather than the S3 endpoint — see the note below.
- [ ] Objects are written with a `Content-Type` (`audio/mpeg`, `application/json`), so the Worker can serve them without sniffing.
- [ ] `del` accepts the literal pathname form the existing callers pass, unchanged.
- [ ] **The client's tests mock `fetch`, not `aws4fetch`** — they assert the request that was actually formed (method, URL, signed headers) and how the response was interpreted.
- [ ] **No consumer test file changes.** `libraryService.test.js`, `audioGenerationService.test.js` and `blobCleanupService.test.js` pass untouched.
- [ ] `@vercel/blob` is removed from `package.json` and imported nowhere.
- [ ] The full suite, `npm run lint` and `npm run format:check` pass.

## Comments

### The `url` in a put response is not the S3 URL

Today `put` returns the URL the write went to, and that URL is also the one a Listener plays from, because Vercel Blob reads and writes on the same host. On R2 they are different hosts: writes go to the S3 endpoint, reads to the Worker. Returning the S3 URL would put an unplayable address into `library/<book>/<chunk>/<voice>.json` and, through it, into anything that trusts stored metadata.

This is the same fact that makes [ticket 04](04-segment-origin-becomes-configuration.md) necessary. Until that lands, the simplest correct thing here is to build the returned `url` from the configured segment origin rather than from the request that was signed. If ticket 04 lands first, take the origin from wherever it put it.

### No consumer test may change — treat a failure here as a finding

This criterion is the whole argument for the seam, and it is worth being strict about. Tickets 08 and 10 both moved substantial machinery — a Redis index, a resume-position store — without touching a consumer test, because storage access was already behind one injected client. If swapping the provider underneath it does require editing `libraryService.test.js`, then something has been reaching past the seam and that is worth finding out now rather than absorbing quietly.
