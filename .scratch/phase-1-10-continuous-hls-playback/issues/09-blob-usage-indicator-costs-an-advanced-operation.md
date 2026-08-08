# 09 — The capacity indicator spends an Advanced Operation on every page load

**What to build:** Stop `BlobUsageIndicator` calling `list()` as a side effect of rendering the home page. The Listener asks for the number; the app does not volunteer it.

**Blocked by:** —

**Status:** ready-for-agent

Found while diagnosing ticket 08's quota exhaustion. Separate bug, separate quota, same root cause shape: a read whose cost nobody was counting.

## What happens

[BlobUsageIndicator.jsx](../../../app/_components/BlobUsageIndicator.jsx) fetches on mount → `/api/blob-usage` → [blobCleanupService.js](../../../app/_lib/blobCleanupService.js)'s `getUsage()` → `storageClient.list()`.

`list()` is a Vercel Blob **Advanced Operation**, and the Hobby plan includes 2,000 per month. The indicator sits on the home page ([page.jsx:82](../../../app/page.jsx#L82)), so **every visit to the home page spends one**, whether or not the Listener cares about storage. The daily cleanup cron and the delete-Book cascade spend from the same 2,000.

## Measured — 2026-08-08, from the Vercel dashboard

| metric                  | reading                 |
| ----------------------- | ----------------------- |
| Simple Operations       | 11.3k / 10k ← ticket 08 |
| **Advanced Operations** | **1.9k / 2k**           |
| Data Transfer           | 127 MB / 10 GB          |
| Storage                 | 5.31 MB / 1 GB          |

At 95% with roughly 100 left, opening the app a hundred more times would have locked the second quota too — and it would have presented as the store being broken for reasons unrelated to anything ticket 08 changed.

This also corrects ticket 08's recorded diagnosis. It reads "Store usage 1.5% of quota — not exhaustion", which was measured against **Storage** — the one metric that was never under pressure. Data Transfer at 127 MB / 10 GB confirms the cost was never bytes; it was call count.

## Why caching is the wrong fix

Considered and rejected before writing any code:

- **`use cache`** — requires `cacheComponents: true` (not set in [next.config.js](../../../next.config.js)), and `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md` states that on serverless "cache entries typically don't persist across requests". Vercel is serverless. It would not reliably prevent a single repeat call.
- **CDN/ISR response caching** — bounds the cost per TTL window rather than eliminating it. Even an hourly window is ~720 operations a month against a 2,000 budget, spent on a number nobody asked to see.

On-demand costs **zero** unless the Listener clicks. That is a guarantee rather than a reduction, which is what a quota with 100 left needs.

- [x] Rendering the home page performs no Blob operation of any kind. _Unit-tested, and confirmed against the running dev server: the only request the home page makes is `/api/library`. `/api/blob-usage` is absent from the network log._
- [x] The Listener can still see the usage percentage and still trigger a cleanup, both from the same place as before.
- [x] A failed usage check leaves the control usable rather than dead, matching how the cleanup button already handles failure.
- [x] The existing cleanup behaviour — cleanup, then refresh the number — is unchanged once usage is on screen.

## Two things the verification run turned up

**A quiet single `get()` also returns 403.** Loading the home page against the live store logs `Vercel Blob: Failed to fetch blob: 403 Forbidden` from [libraryService.js:8](../../../app/_lib/libraryService.js#L8)'s index read — one read, no fan-out, nothing that resembles a burst.

That matters for ticket 08, which reads the 403s as the platform firewall "blocking abnormal or suspicious levels of incoming requests". **A 403 from Blob does not distinguish the two causes**, and right now the store is over its Simple Operations quota (11.3k / 10k), so quota is the sufficient explanation for what is observable today. The only evidence still pointing at the firewall is ticket 08's note that it recovered after roughly half an hour — which a monthly quota would not do. Both may have been happening at different times; what should not survive is the assumption that 403 means firewall.

**`/api/library` is requested three times per home page load.** Each is a `get()`, so each is a Simple Operation. Not investigated (the store is over quota, so every one of them 502s and the behaviour can't be characterised properly), and not fixed here. Same class of bug as this ticket — a Blob read nobody was counting — and likely worth its own once the store is readable again on 2026-09-06.

## Known, not fixed here

`getUsage` and `cleanupBlobs` both call `list()` **without pagination** ([blobCleanupService.js:47](../../../app/_lib/blobCleanupService.js#L47) and [:57](../../../app/_lib/blobCleanupService.js#L57) — single call, no cursor loop). `@vercel/blob`'s `list()` returns at most 1,000 blobs per call, and a 1,983-Chunk Book stores nearly 4,000 (an `.mp3` and a `.json` each). So:

- the percentage is **under-reported** — it sums the first page only;
- `cleanupBlobs` **under-cleans** for the same reason, which is a retention bug, not just a display one.

Deliberately left alone. Fixing it means paginating, which multiplies the Advanced Operations per call by the number of pages — the opposite of what this ticket is for. It wants its own ticket, and it wants to land after there is a cheaper way to know the total (a running byte count in the ticket 08 Redis index would make `list()` unnecessary on this path entirely).
