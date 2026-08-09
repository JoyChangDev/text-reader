# 05 — Cut over, and measure what a Book actually costs

**What to build:** Point the deployed app at R2, clear the Library of abandoned test data, narrate a Book end to end, and record what it cost. Then unblock phase 1.10's stalled criteria.

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-human — needs the deployment, a physical device, and someone watching two dashboards.

This is the ticket that turns the phase's central claim from arithmetic into an observation. Everything before it was written against mocked `fetch`; nothing has yet stored a byte in R2 from the app.

## The data is abandoned, not migrated

The Books in the Vercel store are test material. Nothing is copied. That is what let this phase proceed while the Vercel store is locked over quota — there was never a read to perform.

What must be cleaned up is the _index_, not the bytes: the Library index blob and the Redis Chunk index both still describe Books whose audio now lives nowhere reachable. Left alone, the Library lists Books whose playlists resolve to a store the app no longer talks to. Clear both, then re-upload.

The old Vercel store is left intact rather than deleted. It costs nothing, it is the fallback if this cutover goes badly, and its billing cycle resets on 2026-09-06 regardless.

## The measurement

The problem statement in [the spec](../../../specs/phase-1-11-object-storage-migration.md) rests on arithmetic — two writes per Chunk against a 2,000/month allowance — and admits plainly that generation's share of the old quota was never isolated, because the reading that prompted all this was taken before tickets 09 and 10 removed two other spenders. Narrating a Book on a store with nothing else happening on it is the first chance to close that gap.

Take the Class A count before and after narrating a known number of Chunks. The expected answer is two per Chunk. A materially different number means something writes more than this phase believes, and that is worth knowing before it is a surprise.

While in the dashboards, take Upstash's command count over the same window: [ticket 04](04-segment-origin-becomes-configuration.md) claims generation drops from three commands per Chunk to two, and this is the cheapest possible check of it.

## Acceptance criteria

- [ ] The deployed app reads and writes R2, with the segment origin, R2 credentials and Redis credentials all set in the deployment environment.
- [ ] The Library index blob and the Redis Chunk index are cleared of the abandoned Books; the Library shows no Book whose audio is unreachable.
- [ ] A Book uploads, narrates, and plays from the new store, on a physical iPhone.
- [ ] **Playback crosses at least two segment boundaries with the app backgrounded**, which is the property phases 1.8 to 1.10 exist for and the one a new serving path could quietly break.
- [ ] Seeking to a Sentence inside the currently-playing Chunk works, exercising the Worker's range handling against a real media element rather than against a hand-made request.
- [ ] The resume position survives closing and reopening the Book, and survives on a second device.
- [ ] **Measured: Class A operations per generated Chunk**, recorded here with the Chunk count it was measured over. Expected 2.
- [ ] **Measured: Upstash commands per generated Chunk**, recorded here. Expected 2 after ticket 04.
- [ ] The capacity indicator reports a plausible percentage against 10 GB.
- [ ] Deleting a Book removes its audio from R2, verified by listing the prefix afterwards — this is the path ticket 03's pagination fix exists for.
- [ ] Phase 1.10's [ticket 08](../../phase-1-10-continuous-hls-playback/issues/08-playlist-routes-read-one-blob-per-chunk.md) runbook is run against R2, and its two open criteria are closed or their real numbers recorded.
- [ ] Phase 1.10 tickets 04 and 06 are re-triaged now that a live store is available to them.

## Comments

### Run ticket 08's runbook here, adapted

That runbook was written for a cold session on 2026-09-06, when the Vercel allowance reset. Most of it transfers: the instruments change (R2's Class A/B counters instead of Vercel's Simple/Advanced) and step 0 — check the allowance actually reset — is no longer relevant, but steps 3 through 8 are exactly what wants doing here. In particular its step 3, establishing how to tell an index hit from a Blob fallback before measuring either, still matters: the two sources return identical shapes by design, so the only honest instrument is the counters.

The one thing it says that is now wrong: it expects the first request to be slow because the Book in the store predates the Chunk index. Here every Book is new, so the index is populated from the first generation and there is no cold-start fallback to observe.

### If the measurement disagrees

Two writes per Chunk is what `put` does today — the MP3 and its metadata JSON. If the observed number is higher, the likely causes are a retry inside the signing path or a `Content-Type` correction issued as a second write. If it is lower, something is not being persisted, which is worse. Either way the number belongs in this ticket, not in a commit message, because the spec's whole justification points at it.
