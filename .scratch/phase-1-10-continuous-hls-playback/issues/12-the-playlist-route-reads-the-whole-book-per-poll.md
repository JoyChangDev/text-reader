# 12 — The playlist route reads the whole Book's text on every poll, to learn one integer

**What to build:** Give the HLS routes a way to learn a Book's Chunk count without reading its Chunk text. `readBookAudio` calls `getBook`, which fetches the Book's ~1.6 MB `chunks.json` on every request — and the playlist is polled continuously throughout playback.

**Blocked by:** —

**Status:** resolved — 2026-08-16. Every criterion is met, including the deployed measurement: the playlist poll went 1.32s → 0.72s and is now faster than `/api/library`, which reads the same index without a Book's text in front of it.

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

## Measured again — 2026-08-12, after the change

`getBook` is now two exports. `getBookSummary` reads `library/index.json` and stops;
`readBookChunks` reads the text, and `readBookAudio` calls it only when the caller asked for
cues. Neither the playlist nor the manifest reads the Resume position any more.

Measured against a **production build running locally on the real store** — the same R2
bucket and Upstash instance the deployed app uses, and the same Book — rather than against
the deployed app, because the change is not deployed yet. Same machine, same session, four
warm requests each, before and after taken minutes apart with nothing else changed:

| route               | before    | after     |
| ------------------- | --------- | --------- |
| `/api/library`      | 0.18s     | 0.17s     |
| `…/playlist.m3u8`   | **0.59s** | **0.17s** |
| `…/manifest?from=0` | 0.63s     | 0.55s     |

**The playlist poll lost 0.42s and now costs what listing the Library costs**, which is the
shape the ticket predicted: both routes read the same 17 KB index, and what the playlist
adds on top of that is Redis (the Chunk index, plus a Blob scan on a miss) rather than the
Book's text. The manifest kept its 1.6 MB read — it needs the text, see below — and lost
only the Resume position, worth ~0.08s and one Redis command.

Response bodies were byte-identical across the change on all three routes (13,551 B for the
playlist, 381,256 B for the manifest), which is the correctness half of the measurement.

The deployed baseline was re-taken first and reproduced 2026-08-11's numbers exactly
(library 0.74s, playlist 1.32s, manifest 1.71s), so the ~0.7s round-trip floor is the whole
difference between the two tables. Still owed at the time of writing: the same four requests
against the deployed app once this ships. Taken on 2026-08-16 — see below.

## Measured on the deployed app — 2026-08-16

Shipped, then measured the way the problem was found: same Book, same voice, warm, four
requests each, from the same machine as every table above. The Book was untouched in
between — the playlist body is byte-identical to the pre-change one, so the same Chunks were
generated for both.

| route               | before (2026-08-11) | after (2026-08-16) | saved     |
| ------------------- | ------------------- | ------------------ | --------- |
| `/api/library`      | 0.74s               | 0.77s              | —         |
| `…/playlist.m3u8`   | **1.32s**           | **0.72s**          | **0.60s** |
| `…/manifest?from=0` | 1.70s               | 1.52s              | 0.18s     |

**0.60s per poll, against the 0.6s this ticket predicted.** The stronger reading is the one
that needs no arithmetic about round-trip latency: **the playlist is now faster than
`/api/library`** (0.72s against 0.77s). Both read the same 17 KB index; the playlist's extra
Redis read is cheaper than the Library's `readAll`, and there is no longer 1.6 MB in front of
it. There is nothing left on this path proportional to the Book's text, which is what the
ticket set out to remove.

The manifest's 0.18s is the Resume position lookup — one Redis command, plus the snapshot
Blob read it fell back to whenever Redis held nothing. It keeps its 1.6 MB read, for the
reason in the Comments below.

Cold start was 2.83s for `/api/library` and is excluded; the four rows above are all warm.

## Acceptance criteria

- [x] A playlist request for a Book with a large `chunks.json` does not transfer that blob. The Chunk count comes from somewhere cheap — `totalChunks` on the Library index entry is already written and already read. _With one carve-out the ticket did not anticipate: a Book whose index entry predates `totalChunks` still pays the read, because there is nowhere cheap to ask and an absent count reads as an empty Book rather than as a failure. The one Book in the deployed store has the field._
- [x] The manifest's Blob-fallback path still gets the Chunk text it needs to derive spans, and is still correct when the Chunk index cannot answer. This is the reason the full read exists at all, and it must not become a path that silently returns no Sentences.
- [x] The saving is measured the same way it was found — request timings against the deployed app on a Book whose text is large — and recorded here. A change that only looks cheaper in a unit test has not been shown to do anything. _Measured 2026-08-16 on the deployed app: 1.32s → 0.72s, a 0.60s saving per poll, and the playlist is now faster than `/api/library`. The local production-build run recorded above stands as the corroborating before/after._
- [x] Whatever `readBookAudio` ends up needing is a named thing rather than "a Book minus its text", so the next reader can tell which callers pay for the text and which do not.

## Comments

### Do not fix this by caching `getBook`

The tempting shape is a TTL cache in front of the read. It reintroduces the question ticket 09
already settled for the capacity indicator — a TTL bounds a cost rather than removing it — and
it puts a staleness window on the Chunk count, which is the one number that grows while a Book
is being read. The count is already stored somewhere cheap; read it from there.

### The playlist stopped being able to notice a corrupt Book

Not reading the text means not discovering it is missing, so `BOOK_INCOMPLETE` (ticket 06)
can no longer surface on the playlist path: a Book advertised by the index whose text was
never stored now serves a valid, empty playlist instead of a 502. Judged acceptable rather
than overlooked — the reader page reaches `/api/library/[bookId]` before it points the
element at a playlist, and that still 409s, so the Listener sees the corruption at the point
where something can be done about it. Detecting it a second time on a route polled every
42 seconds would cost the read this ticket removed.

### The manifest needs the text for a second reason this ticket did not name

"`chunks[chunkIndex]`, only inside `withDerivedCues`" is true of `bookAudio.js` and not of
the manifest route: `readBookAudio` _returns_ the text, and `buildBookManifest` counts
Sentence ordinals off it with `splitIntoSentences`. So the manifest reads the Book's text on
every request whether or not the Chunk index answers, and the 1.6 MB is still on that path.

The obvious next move is `sentenceCountsByChunk`, which `addBook` already writes onto the
index entry for exactly this shape of question. It was left alone here because the fallback
is silent in the wrong way: an index entry predating that field would give the manifest no
counts, and the failure mode is every cue id shifted rather than an error — `bookProgress.js`
guards for such entries, so they are not merely hypothetical. Worth its own ticket, with a
look at whether any Book in the store actually lacks the field.

### The resume position on this path is worth its own look

`getBook` exists to open a Book for a Listener, which is why it reads the position. The HLS
routes are not that, and they do nothing with what it returns. Whether the fix is a separate
lookup or a flag on this one, the polled path should not be paying for a position nobody reads.

Settled by the split: `getBookSummary` reads the index and nothing else, so neither HLS route
touches Redis for a position or falls back to the snapshot blob. Only `getBook` — which is
now the composition of the two halves, and is what the reader page calls — still pays for it.
