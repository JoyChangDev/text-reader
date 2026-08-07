# 08 — The HLS routes read one blob per Chunk, and the store rate-limits them

**What to build:** Stop `readCachedChunks` fanning out one Blob read per Chunk of the whole Book on every playlist and manifest request. Both routes need a single read of a per-(Book, voice) index instead.

**Blocked by:** —

**Status:** ready-for-agent

Found by running the real dev server against the live Blob store while trying to close ticket 04's last item. It is a blocker for that item and for ticket 06, and it is not a storage misconfiguration — the app is doing it to itself.

## What happens

[`readCachedChunks`](../../../app/_lib/audioGenerationService.js) issues one `storageClient.get()` per Chunk index, all at once:

```js
return Promise.all(
  Array.from({ length: chunkCount }, (_, chunkIndex) =>
    storageClient.get(cacheKey({ bookId, chunkIndex, voice })),
  ),
);
```

`storageClient.get()` is an unauthenticated HTTPS fetch of a public blob URL. So for the Book currently in the store — 1,983 Chunks — **one request to `/api/books/[bookId]/playlist.m3u8` fans out into 1,983 simultaneous fetches of the Blob store.** The manifest route does the same, and then runs `deriveSentenceSpans` over all of it.

The playlist is an EVENT playlist. The media stack re-fetches it continuously during playback, precisely so it can discover new segments. Every one of those polls costs another full fan-out. The cost is O(Book length) per poll and grows as Books get longer, which is backwards — a longer Book should not make each poll more expensive.

## Measured

|                                                                |                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/api/books/…/playlist.m3u8` on a 1,983-Chunk Book             | **200 OK in 5.4s** (4.7s in application code)                    |
| Public blob URL fetch, single, while quiet                     | 200 OK, real MP3 bytes                                           |
| Public blob URL fetch, single, right after a route call        | **403 Forbidden**                                                |
| Same, re-probed every 30s for 3 minutes                        | 403 the whole way                                                |
| `list()` / `head()` via the authenticated Blob API, throughout | 200, never once blocked                                          |
| Store usage                                                    | 1.5% of quota — not exhaustion                                   |
| Store type                                                     | `*.public.blob.vercel-storage.com` — public, not a private store |

The store has Firewall enabled, and [Vercel Blob's security docs](https://vercel.com/docs/vercel-blob/security) say Blob is behind a platform-wide firewall that "blocks abnormal or suspicious levels of incoming requests". 1,983 parallel unauthenticated reads is that. The authenticated API is unaffected, which is exactly the split observed.

Recovery is not quick: still 403 after three minutes of quiet, recovered after roughly half an hour.

## Why this matters beyond being slow

The failure is **intermittent and looks like something else**. During ticket 06 on a physical device it would present as playback stopping at a segment boundary after a period of listening — indistinguishable from the background-playback failure that whole ticket exists to measure. It would have cost a lot of time to attribute correctly, and could easily have been recorded as an EVENT-playlist finding in ADR 0003 that was never true.

It also means ticket 04's remaining item cannot be honestly checked off: segments do fetch correctly from real Vercel Blob URLs (verified — real MP3 bytes, 200) but only when the store is not busy being rate-limited by our own routes.

- [ ] A playlist or manifest request costs a bounded number of Blob reads, independent of how many Chunks the Book has.
- [ ] Generating a Chunk updates whatever index the routes read, so a growing Book still grows the playlist — the EVENT playlist's whole mechanism depends on it.
- [ ] The index carries what `isPlayableChunk` needs (`url`, `durationSeconds`) and what the manifest needs (`boundaries`), or the routes stay O(Chunk) for the data they can't get from it.
- [ ] A Chunk cached before `durationSeconds` existed is still reported ungenerated, so ticket 02's lazy re-measurement still triggers.
- [ ] The playlist route responds in well under a second on a ~2,000-Chunk Book.
- [ ] A full listening session's worth of playlist polls does not trip the store's rate limiting — verified against the real store, not a fake.
- [ ] `readCachedChunks`'s existing behaviour stays covered: one entry per Chunk index, `undefined` where not cached, never synthesizing.

## Comments

### Design note, not yet decided

The obvious shape is a per-(Book, voice) index blob — one JSON document listing each generated Chunk's `url`, `durationSeconds` and `boundaries` — written by `/api/audio-chunks` as it generates, read once by each route. That turns both routes into a single Blob read.

The open questions are concurrency and size. Concurrency: `/api/audio-chunks` requests fire in parallel (the look-ahead window is requested all at once), so a read-modify-write of a shared index will lose updates unless it is made safe. Size: `boundaries` is word-level TTS output for every Sentence, so a single index for a 2,000-Chunk Book may be large enough to want splitting — possibly a light index for the playlist and per-Chunk metadata still read lazily for the manifest, which only needs the Chunks actually on the timeline.

Worth settling before implementing, since it changes what ticket 03 built.
