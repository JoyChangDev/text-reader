# 03 — Parse ListObjectsV2, and restore `list()`

**What to build:** A pure module that turns a `ListObjectsV2` XML response into the `{ pathname, size, uploadedAt }` records the storage client already returns, and the `list()` method that uses it.

**Blocked by:** 02

**Status:** ready-for-human — built and green, and no consumer test changed. One criterion was met somewhere other than where it was written; the write-up is below.

The price of choosing `aws4fetch` over the AWS SDK ([ticket 02](02-object-storage-client-on-aws4fetch.md)): listing comes back as XML rather than as objects. The repo has direct precedent for paying that price rather than taking on a dependency — `mp3Frames.js` walks MP3 frame headers by hand, with `mp3Frames.fixture.js` supplying bytes, because an audio library would have been far more than was needed to sum frame durations.

## What consumes it, and how much it matters

Two callers, neither on a hot path:

- `blobCleanupService`'s `getUsage` and `cleanupBlobs` — the capacity indicator and the daily cron.
- `libraryService`'s `deleteBook`, which lists a Book's prefix to cascade the delete.

The second is the one with teeth: a listing that silently returns fewer keys than exist leaves orphaned audio in the bucket forever, and nothing ever notices because the Book is already gone from the index.

## Acceptance criteria

- [x] A pure module parses a `ListObjectsV2` response body into ordered `{ pathname, size, uploadedAt }` records, with `size` a number and `uploadedAt` a `Date`-compatible value, matching what callers receive today.
- [x] It is tested against fixture XML, following `mp3Frames.fixture.js`'s pattern: a normal multi-key response, a response with no keys, and one whose keys contain XML-escaped characters.
- [x] A truncated or malformed body returns what could be parsed rather than throwing, matching how `mp3Frames.js` treats a truncated file.
- [x] `list(prefix)` on the storage client returns the same shape it does today, scoped to the prefix.
- [x] **`list()` follows the continuation token**, so a prefix with more than 1,000 keys is fully listed — see below.
- [x] `deleteBook`'s cascade still removes every audio and metadata object under a Book's prefix, verified with a fake returning more than one page. The multi-page fake is at `fetch`, not at `list()` — see "Where the multi-page fake had to go" below.
- [x] No consumer test file changes.
- [x] The full suite (534 tests, 54 files) and `npm run lint` pass. `npm run format:check` does **not**, and reports the same 97 files with this work as without it — see [ticket 02](02-object-storage-client-on-aws4fetch.md)'s "format:check was already failing".

## Comments

### Pagination is fixed here, not deferred

[Ticket 09](../../phase-1-10-continuous-hls-playback/issues/09-blob-usage-indicator-costs-an-advanced-operation.md) recorded that `getUsage` and `cleanupBlobs` call `list()` without pagination, that the cap is 1,000 keys per call, and that a 1,983-Chunk Book stores nearly 4,000 objects — so usage is under-reported and cleanup under-cleans. It deliberately left the fix alone, for a reason it stated plainly: paginating multiplies the Advanced Operations per call by the number of pages, against a 2,000/month allowance.

**That objection is gone.** On R2 a list is a Class A operation against a 1,000,000/month allowance, so a second page costs nothing worth counting. Since this ticket rewrites the call from scratch, omitting the continuation loop would mean knowingly writing a bug whose only justification has just been removed.

This is a deliberate exception to the phase's "change one thing at a time" rule, and it is worth being explicit about why it is not really one: the rule exists so that a later regression stays attributable to either the move or a behaviour change. Pagination is neither — it is the correctness of a function being written fresh in this ticket. The retention rule, which _is_ a behaviour change, stays out and keeps its own ticket; what the right policy is now that the store holds thirty Books instead of three is a separate question from whether `list()` returns everything it was asked for.

### Where the multi-page fake had to go

Two criteria pull against each other once pagination lives inside `list()`: "verified with a fake returning more than one page" and "no consumer test file changes". `deleteBook` cannot see a page — it calls `list('<bookId>/')` and deletes what comes back — so a fake it could substitute would have to be a fake `list()`, and a fake `list()` returning two pages is not a thing the seam permits. The test would be asserting over a client that does not exist.

The verification is therefore split across the two places it can honestly live, and together they cover the claim:

- **`objectStorageClient.test.js`** fakes `fetch` and returns a first page carrying a `NextContinuationToken`. It asserts both keys come back and that the second request carried `continuation-token`. That is "`list()` returns everything under the prefix".
- **`libraryService.test.js`** is untouched and already asserts that `deleteBook` deletes every pathname `list()` returned, scoped to `<bookId>/`. That is "the cascade deletes everything `list()` returns".

The composition is what the criterion asked for. Faking `fetch` rather than the client is also the arrangement [ticket 02](02-object-storage-client-on-aws4fetch.md) settled on for `progressiveGeneration.test.js`, for the same reason: with the client signing its own requests, `fetch` is the lowest level, and everything above it stays real.

### The parser keeps a record it cannot fully read, and drops one it cannot use at all

Two judgement calls the criterion's "returns what could be parsed" leaves open, decided by asking what the caller would do next.

**A `<Contents>` with an unreadable `<Size>` is kept, with `size` 0.** Every consumer's next move with a record is to delete the pathname or to add up bytes. Dropping it would take the key out of `cleanupBlobs`' and `deleteBook`'s reach permanently — an object nothing can ever see again — to avoid `getUsage` under-reporting by one file.

**A `<Contents>` with no `<Key>` is dropped.** It names no object, so there is nothing a caller could do with it in either direction.

A truncated body needs no handling at all, which is the nice part: its final `<Contents>` never closes, so it never matches, and "keep what was measurable and stop" falls out of the shape of the parse rather than being a branch. Same as `mp3Frames.js` walking off the end of a short file.

### What is deliberately not a general XML parser

`<Contents>` does not nest, the wanted fields are leaf text, and S3 sends no attributes, no CDATA and no entities beyond the five escapes. A regex per element is the whole job. The five entities are unescaped with `&amp;` last, so a key containing the literal text `&amp;lt;` survives as `&lt;` rather than being unescaped twice into `<`.

### What code review changed

The parser and the loop were both lenient, and the leniency reached one place it should not have.

**Fixed — a short listing was indistinguishable from a complete one.** The loop ran on `NextContinuationToken` alone, on the reasoning that S3 sends one whenever it truncates, so a body without one is the last page. True of a well-formed response; not true of a cut-short body or of a 200 carrying an HTML error page from something in front of the endpoint. Both parsed to a token-less page and ended the loop, and the records that did arrive have exactly the shape of a complete listing. That is precisely the failure this ticket's own opening names — "a listing that silently returns fewer keys than exist leaves orphaned audio in the bucket forever" — arriving through the one path the ticket asked us to treat leniently.

The split now follows what each layer is for. **The parser stays lenient and still never throws**, per the criterion, but reports two facts about the answer alongside the records: `isTruncated`, and `isListing` — false when the body carries no `<IsTruncated>` at all, which every real ListObjectsV2 response does, including an empty one. **`list()` refuses on either**, matching what it already does about a 403 and what ticket 02 decided about `get`: a broken store must never be mistaken for an empty one.

**Fixed — the loop could hang.** A store answering with the token it was just handed would spin forever. Both callers are things that have to finish — the daily cron and a Listener's delete — and a request that never returns is worse to diagnose than one that fails. One comparison, then throw.

**Fixed — the continuation token was not unescaped**, though `Key` was. S3 escapes both the same way.

**Fixed — `toRecord` returned an array**, so it is `toRecords`.

**Also noted, and acted on: `Segment` was not in the glossary.** `docs/agents/domain.md` asks for a concept that has become first-class to be recorded, and this phase made one — segment origin, segment Worker, segment URL, a module named for it, an environment variable. `CONTEXT.md` now defines it, including that its origin is always configuration and never the host writes go to.

**Left deliberately.** `put` resolves the origin through `requireSegmentOrigin(overrides.segmentOrigin)` rather than through `settings()`, which every R2 setting goes through — the origin is not an R2 setting, names a different host, and is shared with the Chunk index, which is the whole reason it lives in its own module. And `request`/`listPage` share a two-line credentials preamble; extracting it would hide which of the two addresses a key and which addresses the bucket, which is the difference the comment on `listPage` exists to explain.
