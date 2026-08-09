# 04 — The segment origin becomes configuration, and leaves Redis

**What to build:** Take the store's origin out of the Chunk index and out of write responses, and make it explicit configuration. Update the capacity quota to R2's 10 GB while in the area.

**Blocked by:** 02

**Status:** ready-for-agent

## Why the existing arrangement stops working

[Ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) decided this, and recorded the reasoning:

> **Where the segment URL's origin comes from — decided.** It is recovered from a real `put` response and recorded once, rather than parsed out of `BLOB_READ_WRITE_TOKEN` (undocumented token format) or configured as a second env var.

**That held only while reads and writes shared a host.** On R2 they do not: the app writes to the S3 endpoint, the Listener plays from the Worker. A write response can no longer yield the origin a segment is played from, so the mechanism is not merely inconvenient — it produces a wrong answer.

The env var it rejected is now the only correct source, and its stated objection ("a second thing to get wrong") is answered by the fact that a misconfigured origin fails immediately and loudly on the first segment fetch, rather than subtly.

## What this removes

Making the origin configuration is a simplification everywhere it touches:

- `storeBase()` in `chunkIndex.js` — deleted. `deriveSegmentUrl()` stays, taking the configured base.
- The Chunk index's global origin key, the `SET` that rewrote it on **every generated Chunk**, and the pipelined `GET` that fetched it alongside the durations hash — all deleted. Generation drops from three Redis commands per Chunk to two, and the playlist's read becomes a single `HGETALL` instead of a two-command pipeline.
- `readIndexedRun`'s `base` argument stops coming from the index read and comes from configuration.

It also dissolves a hazard rather than mitigating it. While the origin was stored, a cutover left every playlist pointing at the old store until the next generation rewrote it. With no stored origin, there is nothing to go stale.

## Acceptance criteria

- [ ] The segment origin comes from a single environment variable, documented in the README alongside the Redis and R2 credentials.
- [ ] An absent or malformed origin fails at startup or at the seam with a clear message, rather than producing URLs that 404.
- [ ] `storeBase()` and its tests are gone; `deriveSegmentUrl()` builds URLs from the configured origin and keeps its tests.
- [ ] **The Chunk index stores no origin.** The origin key, its per-write `SET` and the pipelined read are all removed, and `redisChunkIndex.test.js` no longer asserts any of them.
- [ ] `writeChunk` issues two Redis commands per Chunk, not three; `readIndex` issues one.
- [ ] A playlist built from an index written before this change still resolves to playable URLs — the index carries durations, and the origin now comes from configuration, so old entries are unaffected.
- [ ] `BLOB_QUOTA_BYTES`' default becomes R2's 10 GB, so the capacity indicator reports against the real capacity rather than a tenth of it.
- [ ] The retention rule is **unchanged** — same seven days, same exclusions.
- [ ] No consumer test file changes beyond the Chunk index's own.
- [ ] The full suite and `npm run lint` pass.

## Comments

### Supersede the note in ticket 08, don't just contradict it

Ticket 08's "Where the segment URL's origin comes from — decided" section is quoted above and is about to become wrong. Mark it superseded in place, the way that ticket's own 2026-08-08 correction was marked, with a pointer here. A cold session reading ticket 08 for the Chunk index's design should not have to discover from the code that one of its recorded decisions was reversed.

### The quota constant keeps its name

It is `BLOB_QUOTA_BYTES`, and "blob" is Vercel's product name. Renaming it belongs to the separate naming ticket along with the routes, the cron path and the usage component — only the storage client module is renamed in this phase, because that file is being rewritten anyway. Changing the value here without changing the name is deliberate, not an oversight.
