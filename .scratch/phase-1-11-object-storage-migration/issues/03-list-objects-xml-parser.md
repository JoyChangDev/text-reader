# 03 — Parse ListObjectsV2, and restore `list()`

**What to build:** A pure module that turns a `ListObjectsV2` XML response into the `{ pathname, size, uploadedAt }` records the storage client already returns, and the `list()` method that uses it.

**Blocked by:** 02

**Status:** ready-for-agent

The price of choosing `aws4fetch` over the AWS SDK ([ticket 02](02-object-storage-client-on-aws4fetch.md)): listing comes back as XML rather than as objects. The repo has direct precedent for paying that price rather than taking on a dependency — `mp3Frames.js` walks MP3 frame headers by hand, with `mp3Frames.fixture.js` supplying bytes, because an audio library would have been far more than was needed to sum frame durations.

## What consumes it, and how much it matters

Two callers, neither on a hot path:

- `blobCleanupService`'s `getUsage` and `cleanupBlobs` — the capacity indicator and the daily cron.
- `libraryService`'s `deleteBook`, which lists a Book's prefix to cascade the delete.

The second is the one with teeth: a listing that silently returns fewer keys than exist leaves orphaned audio in the bucket forever, and nothing ever notices because the Book is already gone from the index.

## Acceptance criteria

- [ ] A pure module parses a `ListObjectsV2` response body into ordered `{ pathname, size, uploadedAt }` records, with `size` a number and `uploadedAt` a `Date`-compatible value, matching what callers receive today.
- [ ] It is tested against fixture XML, following `mp3Frames.fixture.js`'s pattern: a normal multi-key response, a response with no keys, and one whose keys contain XML-escaped characters.
- [ ] A truncated or malformed body returns what could be parsed rather than throwing, matching how `mp3Frames.js` treats a truncated file.
- [ ] `list(prefix)` on the storage client returns the same shape it does today, scoped to the prefix.
- [ ] **`list()` follows the continuation token**, so a prefix with more than 1,000 keys is fully listed — see below.
- [ ] `deleteBook`'s cascade still removes every audio and metadata object under a Book's prefix, verified with a fake returning more than one page.
- [ ] No consumer test file changes.
- [ ] The full suite and `npm run lint` pass.

## Comments

### Pagination is fixed here, not deferred

[Ticket 09](../../phase-1-10-continuous-hls-playback/issues/09-blob-usage-indicator-costs-an-advanced-operation.md) recorded that `getUsage` and `cleanupBlobs` call `list()` without pagination, that the cap is 1,000 keys per call, and that a 1,983-Chunk Book stores nearly 4,000 objects — so usage is under-reported and cleanup under-cleans. It deliberately left the fix alone, for a reason it stated plainly: paginating multiplies the Advanced Operations per call by the number of pages, against a 2,000/month allowance.

**That objection is gone.** On R2 a list is a Class A operation against a 1,000,000/month allowance, so a second page costs nothing worth counting. Since this ticket rewrites the call from scratch, omitting the continuation loop would mean knowingly writing a bug whose only justification has just been removed.

This is a deliberate exception to the phase's "change one thing at a time" rule, and it is worth being explicit about why it is not really one: the rule exists so that a later regression stays attributable to either the move or a behaviour change. Pagination is neither — it is the correctness of a function being written fresh in this ticket. The retention rule, which _is_ a behaviour change, stays out and keeps its own ticket; what the right policy is now that the store holds thirty Books instead of three is a separate question from whether `list()` returns everything it was asked for.
