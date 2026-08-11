# 12 — The playlist route reads the whole Book's text on every poll, to learn one integer

**What to build:** Give the HLS routes a way to learn a Book's Chunk count without reading its Chunk text. `readBookAudio` calls `getBook`, which fetches the Book's ~1.6 MB `chunks.json` on every request — and the playlist is polled continuously throughout playback.

**Blocked by:** —

**Status:** ready-for-agent

This is [ticket 08](08-playlist-routes-read-one-blob-per-chunk.md)'s shape, in the one place it
did not look. That ticket removed an O(Book) fan-out of one storage read per Chunk from the
polled path. What it left is a single storage read that is O(Book) in bytes rather than in
requests, and it is on the same path for the same reason: nothing had ever measured the route
end to end against a real store.

## What happens

[`bookAudio.js`](../../../app/_lib/bookAudio.js) opens with:

```js
const book = await getBook(bookId);
```

and then uses `book.chunks` for exactly two things: `book.chunks.length`, to validate `from`
and bound the indexed run; and `chunks[chunkIndex]`, only inside `withDerivedCues`, which is
the **Blob-fallback** path the manifest takes when the Chunk index cannot answer.

So on the path that actually runs during playback — index hit, playlist route, `needsCues`
false — the Book's entire text is fetched and one integer is taken from it.
[`getBook`](../../../app/_lib/libraryService.js) also reads `library/index.json` and the resume
position on the way, and the index entry it finds there **already carries `totalChunks`**,
written by `addBook` for precisely this kind of question.

## Measured — 2026-08-11

Deployed app, Book `f844b066…` (4,962 Chunks, 92 generated, `chunks.json` 1.6 MB), four
requests each, warm:

| route               | what it reads                                      | response | time      |
| ------------------- | -------------------------------------------------- | -------- | --------- |
| `/api/library`      | `index.json` (17 KB) + Redis                       | 17 KB    | **0.74s** |
| `…/playlist.m3u8`   | the above **+ 1.6 MB `chunks.json`** + Chunk index | 11 KB    | **1.32s** |
| `…/manifest?from=0` | the above + cues                                   | 349 KB   | **1.70s** |

Cold start was 2.4s for the playlist. The ~0.7s floor is round-trip latency from the measuring
machine, so the interesting figure is the gap: **the playlist route spends roughly 0.6s per poll
fetching 1.6 MB it does not use.** The playlist is re-fetched every `TARGETDURATION`/2 or so —
observed at ~42s intervals on the device — for as long as a Listener is listening.

**It also costs a Redis command that ticket 08's accounting does not include.** `getBook` reads
the resume position, so the polled path spends that on top of the Chunk index read, and falls
back to a further storage read for the snapshot whenever Redis has nothing for the Book.

## Why this was invisible until now

Ticket 08 measured what it changed. Its stage 1 note times "one request" and watches the number
fall from 5.4s to well under a second — but that was against the dev server and the old store,
and the Book in question had a small `chunks.json`. The blob whose size matters here is
proportional to the Book's text, and the Books this was measured on before were short. At 4,962
Chunks it is 1.6 MB; the phase's own target of ~2,000 Chunks would be ~700 KB.

## Acceptance criteria

- [ ] A playlist request for a Book with a large `chunks.json` does not transfer that blob. The Chunk count comes from somewhere cheap — `totalChunks` on the Library index entry is already written and already read.
- [ ] The manifest's Blob-fallback path still gets the Chunk text it needs to derive spans, and is still correct when the Chunk index cannot answer. This is the reason the full read exists at all, and it must not become a path that silently returns no Sentences.
- [ ] The saving is measured the same way it was found — request timings against the deployed app on a Book whose text is large — and recorded here. A change that only looks cheaper in a unit test has not been shown to do anything.
- [ ] Whatever `readBookAudio` ends up needing is a named thing rather than "a Book minus its text", so the next reader can tell which callers pay for the text and which do not.

## Comments

### Do not fix this by caching `getBook`

The tempting shape is a TTL cache in front of the read. It reintroduces the question ticket 09
already settled for the capacity indicator — a TTL bounds a cost rather than removing it — and
it puts a staleness window on the Chunk count, which is the one number that grows while a Book
is being read. The count is already stored somewhere cheap; read it from there.

### The resume position on this path is worth its own look

`getBook` exists to open a Book for a Listener, which is why it reads the position. The HLS
routes are not that, and they do nothing with what it returns. Whether the fix is a separate
lookup or a flag on this one, the polled path should not be paying for a position nobody reads.
