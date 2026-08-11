# 11 — The standalone PWA is killed while backgrounded, and audio dies with it

**What to build:** Nothing yet. Establish first that iOS really does reclaim the home-screen PWA's process ~101 seconds into backgrounded playback — it has been seen once — and only then find out why it happens there when the same app in a Safari tab survives 691 seconds and the ADR 0003 spike's inert PWA survived 340.

**Blocked by:** —

**Status:** needs-info — **this rests on a single observation.** The next step is to repeat it unchanged, not to explain it. See "Step 1".

Opened by [ticket 06](06-verify-growing-playlist-in-background.md), whose last criterion says a
failing run gets its mitigation re-planned as its own ticket rather than papered over with a
retry in `useBookPlayer` — "which is the pattern Phase 1.9 already tried." That instruction
carries over here verbatim, and it is the most important line in this ticket.

## What was measured

2026-08-11, physical iPhone, Book `f844b066…` on R2. Full numbers as run 4 in
[the spike log](../../hls-background-spike/spike-log.md).

Launched from the home screen, playback started, screen locked at `13:05:43.864Z`. Audio stopped
at ~13:07 **while the screen was still locked** — the Listener only unlocked afterwards, so this
is not a return-to-foreground reload. The diagnostic ring buffer holds nothing between the lock
and a fresh `mediaSessionRegistration` at `13:07:35`:

```
13:04:45.630Z  mediaSessionRegistration {"supported":true}
13:05:43.864Z  visibilitychange {"visibilityState":"hidden"}
   ( 111 seconds of nothing )
13:07:35.015Z  mediaSessionRegistration {"supported":true}
```

No `pagehide`, no `visibilitychange visible`, no `reconcile`. The page never ran again, and the
`pagehide` flush phase 1.8 ticket 03 added for exactly this case did not fire. The deployment's
request log shows a whole new document (`GET /book/<bookId>`) at `13:07:27`.

**Playback was healthy until the moment it stopped existing.** In those 101 seconds: 15
`PATCH /api/library` (one per Sentence, so the position was advancing), 4 `POST /api/audio-chunks`,
playlist polls ~42s apart matching `TARGETDURATION`, and 5 Chunks written to R2 after the lock.
Nothing was stalling, starving, or erroring.

## An earlier PWA session that this does not explain

The same afternoon, at 12:00, a standalone session failed differently and with no diagnostic
log at all (it predates the realisation that a PWA and a Safari tab keep separate
`localStorage`, so the log that was copied came from the other container). What is known comes
from storage and request logs rather than the device:

- the look-ahead never went past its initial 11 Chunks, where the 13:04 run generated 5 more
  while hidden;
- the stored resume position was still Chunk 0 / Sentence 0 afterwards, where the 13:04 run
  saved one per Sentence throughout;
- the Listener reports Sentence highlighting that was stuck and did not match the audio.

**A process reclaimed after 101 seconds does not produce that.** The 13:04 run advanced
normally until the moment it died. So either the 12:00 session failed much earlier and for
another reason, or playback never really started in it. It is carried here rather than in
[ticket 06](06-verify-growing-playlist-in-background.md) because it is a PWA failure, but it
should not be assumed to be the same one — and the honest next step for it is to reproduce it
with a log this time, not to reason further from three indirect signals. (Reasoning from
exactly those three signals already produced one wrong diagnosis in this session; see the
device-session notes in phase 1.11 [ticket 05](../../phase-1-11-object-storage-migration/issues/05-cut-over-and-measure.md).)

## The three runs, and what they do and do not separate

|                 | context        | playlist      | what the page did while hidden | outcome          |
| --------------- | -------------- | ------------- | ------------------------------ | ---------------- |
| ADR spike run 2 | standalone PWA | static VOD    | **nothing at all**             | 340s, passed     |
| ticket 06 run A | Safari tab     | growing EVENT | ~1 request every 2–6s          | 691s, passed     |
| ticket 06 run B | standalone PWA | growing EVENT | ~1 request every 2–6s          | **101s, killed** |

Two things are ruled out. **"A standalone PWA cannot play in the background" is false** — the
spike's did, for 340s. **"This app's background behaviour is fatal" is false** — the identical
behaviour survived 691s in a tab.

Only the combination fails. But the two passing runs differ from the failing one in _two_ ways
at once (context, and whether the page does anything), so these three runs **cannot** tell
"standalone is stricter" from "network I/O while hidden is what gets you reclaimed". Do not
write the conclusion into a fix before separating them.

## Step 1 — find out whether it reproduces at all

**One process kill is not a phenomenon.** iOS reclaims backgrounded processes against memory
pressure, battery level, Low Power Mode and whatever else is resident, none of which were
controlled or recorded. 101 seconds could be a property of this app or a property of that
minute. Nothing below is worth doing until that is settled.

Repeat Run B **unchanged** two or three times: standalone PWA, same Book, play, lock, wait past
ten minutes or until the audio stops. Record the survival time each run, plus battery percentage
and whether Low Power Mode is on — the two confounders that are free to note and impossible to
recover afterwards.

- Consistently ~100s → a phenomenon, and step 2 is worth its cost.
- One run past ~600s → the observed kill was situational. Downgrade this ticket and say so;
  the Listener's real complaint would then be intermittent rather than systematic, which is a
  different ticket with a different shape.

## Step 2 — only then, separate the two variables

**This needs a code change and a deployment, which is why it is second.** The obvious no-code
version of it does not work, and the reason is worth writing down because it looks like it
should:

> _Play a stretch that is already generated, so the look-ahead has nothing to fetch._

It does not quiet anything. [`chunkFetchPlan`](../../../app/_lib/chunkFetchPlan.js) skips a
Chunk based on `statuses`, which is the client's own `chunkAudio` state — empty on every mount —
not on whether the object exists in R2. So the look-ahead issues a `POST /api/audio-chunks` for
every Chunk it advances into regardless, and an already-generated Chunk merely makes that
request a cache hit. The per-Sentence `PATCH /api/library` is louder still and is driven by
playback position alone ([useBookPlayer.js](../../../app/_lib/useBookPlayer.js)), so it is
entirely unaffected. Request _count_ is what would have to change, and pre-generating changes
only request _cost_.

So the experiment is: suspend the position saves and the look-ahead while
`document.visibilityState === 'hidden'`, deploy that, and re-run. Everything else identical —
same playlist, same Worker, same element, same lock.

- Survives well past the step 1 figure → background network I/O is what gets the process
  reclaimed, and the fix is about what this app does while hidden.
- Dies at about the same time → standalone is simply stricter than a tab, and the fix is
  somewhere else entirely — possibly nowhere in this codebase.

Note that suspending the position saves while hidden is not obviously safe to keep: a process
killed while hidden then loses everything since the last save, and the flush that was supposed
to cover that is exactly what does not fire here. Treat it as instrumentation to be reverted,
not as a candidate fix that happens to double as a probe.

## What not to do first

**Do not add a retry, a resume-on-foreground, or a watchdog.** Phase 1.9 tried that shape and
ADR 0003 records why it was wrong: it treated the symptom and left the mechanism unexamined for
two phases. A process that no longer exists cannot retry anything from the inside, so a retry
here would at best restart playback after the Listener has already noticed the silence.

**Do not reach for the Phase 2 native wrapper as the answer to this ticket.** It probably is the
real answer — a native background-audio entitlement is the only thing that makes this a
non-question — but ADR 0003 lists it as the Phase 2 direction with an unresolved edge-tts AGPL
question attached, and reaching for it now would skip the measurement above, which is cheap and
which the wrapper decision should be informed by.

## Acceptance criteria

- [ ] **Step 1: Run B is repeated at least twice unchanged**, and each run's survival time is recorded in [the spike log](../../hls-background-spike/spike-log.md) with the same shape as runs 1–4, along with battery level and Low Power Mode.
- [ ] The kill is established as reproducible or as situational, **and this ticket's status follows that answer** rather than staying open on one observation.
- [ ] Step 2 is run only if step 1 says there is something to separate, and its instrumentation is reverted afterwards rather than shipped.
- [ ] The result names which of the two variables is responsible, or says explicitly that it could not separate them and why.
- [ ] If background network I/O is implicated, the specific callers are quantified — one `PATCH` per Sentence is the loudest, and its cadence is a deliberate choice made in ticket 10 that would be re-opened rather than assumed.
- [ ] Whatever is concluded, ADR 0003 gains a follow-up section: it is the document that claims a single continuous element solves background playback, and standalone mode is the production condition.
