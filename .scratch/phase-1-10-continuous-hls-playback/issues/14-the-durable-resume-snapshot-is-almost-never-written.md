# 14 — The durable resume snapshot is almost never written

**What to build:** Make the backgrounding flush actually write a snapshot. Its guard skips the write whenever the position has already been sent to Redis — which, at a 400 ms debounce against multi-second Sentences, is nearly always. The blob it exists to maintain has never been written for the Book currently in the store.

**Blocked by:** —

**Status:** ready-for-agent

Found on 2026-08-11 while running phase 1.11 [ticket 05](../../phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md)'s
resume criterion, by looking for the snapshot blob before relying on it.

## Observed

After a full day of listening on a physical device — many lock/unlock cycles, several deliberate
backgrounded runs of 650 s and 691 s, and one process kill — the Book in the store has **no
snapshot at all**:

```
library/f844b066-…/chunks.json   1,635,413 B   12:00:41Z
library/index.json                   10,073 B   14:33:32Z
```

`library/f844b066-…/resume.json` is absent. Redis meanwhile holds the position and is being
updated once per Sentence.

## Why

[`useBookPlayer.js`](../../../app/_lib/useBookPlayer.js), the flush that runs on
`visibilitychange → hidden` and on `pagehide`:

```js
clearTimeout(persistTimeoutRef.current);
const last = lastPersistedRef.current;
if (last && last.chunkIndex === currentIndex && last.sentenceIndex === activeSentenceIndex) {
  return;
}
persistResumePosition(currentIndex, activeSentenceIndex, { snapshot: true });
```

`lastPersistedRef` records the last position **sent**, whichever kind of write sent it. The
ordinary per-Sentence save is `snapshot: false` — Redis only, no blob — and it updates that ref
just the same. So an ordinary write suppresses the snapshot the flush was going to take.

`RESUME_PERSIST_DEBOUNCE_MS` is **400**. A Sentence runs several seconds. So within 400 ms of
every Sentence boundary the position is in Redis and the ref matches, and it goes on matching
for the rest of that Sentence. **The flush writes a snapshot only if backgrounding lands inside
the 400 ms window right after a Sentence changes** — a few percent of the time, by luck.

The guard is not wrong about what it checks; it checks the wrong thing. "This position is
already in Redis" and "a durable snapshot of this position exists" are different facts, and
only the second one is a reason to skip a snapshot write.

## Why it matters more than it looks

The snapshot is the fallback in [`getBook`](../../../app/_lib/libraryService.js):

```js
const position =
  (await positionClient.read(bookId)) ?? (await storageClient.get(resumeSnapshotKey(bookId)));
```

So today the resume position lives in exactly one place. Redis unreachable, evicted, or wiped
and the Listener loses their place in the Book entirely — the fallback resolves `undefined`,
`withPosition` falls through to `NO_POSITION`, and the Book reopens at the start. That is the
outcome the snapshot was designed to prevent, and it is the reason the Redis client's own
comments treat Redis as a cache rather than a source of truth.

It is also the exact scenario [ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md)
recorded: a process killed while backgrounded, with no `pagehide` and no chance to run anything.
There the per-Sentence Redis writes happened to have kept up, so nothing was lost — but that is
the debounce covering for the mechanism, not the mechanism working.

## Acceptance criteria

- [ ] Backgrounding a Book that is being read writes `library/<bookId>/resume.json`, reliably rather than when the timing happens to allow it. Verified against the real store: background, then list `library/`.
- [ ] It still costs at most one blob write per backgrounding — the bound the flush's comment claims and the reason ticket 10 moved the position out of the index in the first place. Backgrounding twice at the same position should not write twice.
- [ ] The per-Sentence path still writes no blob at all. That is the whole of ticket 10 and must not regress in the course of fixing this.
- [ ] Covered at the seam, with a test that fails on the current guard — the shape is "advance a Sentence, let the debounce fire, then background, and assert a snapshot was requested".

## Comments

### What the guard should compare against

The cheapest correct version is a second ref recording the last position written **as a
snapshot**, and comparing against that instead. Backgrounding at an unchanged position then
costs nothing on the second occasion, which is the bound the criterion above asks for, and no
ordinary Redis write can suppress it.

Note that the server already resolves the harder half of this: `updateResumeIndex` only writes
the snapshot when Redis did not reject the position as stale, and re-reads the stored snapshot
to compare when Redis could not be reached at all. Nothing about that needs to change; the
client simply has to ask.

### Do not fix it by deleting the guard

Backgrounding fires more often than a Listener would guess — every app switch, every lock, and
`pagehide` on top. Removing the check outright would put a blob write on all of them, which is
the cost ticket 10 was written to remove. The guard is right to exist.
