# 11 — The standalone PWA is killed while backgrounded, and audio dies with it

**What to build:** Nothing yet. Establish first that iOS really does reclaim the home-screen PWA's process ~101 seconds into backgrounded playback — it has been seen once — and only then find out why it happens there when the same app in a Safari tab survives 691 seconds and the ADR 0003 spike's inert PWA survived 340.

**Blocked by:** —

**Status:** needs-info, parked — **step 1 was run on 2026-08-11 and the kill did not reproduce.** A repeat in the same context 21 minutes later survived 650s, and a third window survived 1214s. One sighting, two non-reproductions: this is situational, not systematic, and step 2 is not worth a deployment on that basis. Reopen if it is seen again; what to record is under "If it happens again".

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

> **Overtaken by run 5.** A fourth row belongs in that table — standalone PWA, growing EVENT,
> ~1 request every 2–6s, **650s, passed** — sitting in the same cell as run B with the opposite
> outcome. Two runs identical in every variable this ticket was trying to separate, disagreeing,
> is not a variable problem. It means the effect is not stable enough to attribute to anything
> yet, and it retires the background-I/O hypothesis directly: the run that survived made exactly
> the same requests at the same cadence as the one that died.

## Step 1 — did it reproduce? No. Answered 2026-08-11

**One process kill is not a phenomenon.** iOS reclaims backgrounded processes against memory
pressure, battery level, Low Power Mode and whatever else is resident, none of which were
controlled or recorded when run 4 died. So run B was repeated unchanged — standalone PWA, same
Book, same device, same afternoon, battery 34%, Low Power Mode off.

| window              | backgrounded | outcome                                                       |
| ------------------- | ------------ | ------------------------------------------------------------- |
| 13:05:43 → 13:07:35 | 101s         | **killed**                                                    |
| 13:07:43 → 13:27:57 | 1214s        | alive, playback stopped (not a run — nothing generated)       |
| 13:28:18 → 13:39:08 | **650s**     | **alive and still playing**, 30 Chunks generated while hidden |

**It did not reproduce.** Full numbers as run 5 in [the spike log](../../hls-background-spike/spike-log.md).

So the kill is **situational, not systematic**, and the table below no longer describes a
standing property of the standalone context — it describes one minute in which a process was
reclaimed. Step 2 is not worth a code change and a deployment on that basis, and this ticket
parks rather than proceeding.

**What this does and does not say.** It does not say the kill was imaginary: the log's 111-second
silence, the absent `pagehide`, and the fresh document load are all real, and audio really did
stop while the screen was locked. It says only that whatever caused it was not present 21
minutes later under conditions we know of no difference in.

### If it happens again

The evidence that would turn this back into a phenomenon is a second sighting with enough
context to correlate. Record, at the time: battery percentage, Low Power Mode, how long the app
had been running, what else was open, and whether anything heavy had just happened on the device.
Two sightings sharing a condition is worth more than ten more clean runs.

Worth noting for whoever picks this up: **the app cannot tell this happened.** A killed process
leaves no trace in its own log beyond the gap, and the Listener experiences it as silence. If
sightings accumulate, "make a process kill visible and recoverable" is a better-shaped ticket
than "stop iOS reclaiming us", and it does not require winning an argument with the platform.

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

- [x] **Step 1: Run B is repeated at least twice unchanged**, and each run's survival time is recorded in [the spike log](../../hls-background-spike/spike-log.md) with the same shape as runs 1–4, along with battery level and Low Power Mode. _Run 5, plus the non-run window between them; battery 34%, Low Power Mode off._
- [x] The kill is established as reproducible or as situational, **and this ticket's status follows that answer** rather than staying open on one observation. _Situational — 650s and 1214s against one 101s. Status is now parked._
- [ ] Step 2 is run only if step 1 says there is something to separate, and its instrumentation is reverted afterwards rather than shipped. _Not run, and correctly so: step 1 says there is nothing yet to separate._
- [ ] The result names which of the two variables is responsible, or says explicitly that it could not separate them and why. _Neither. The failing observation is unreproduced, so there is no stable effect to attribute to either variable._
- [ ] If background network I/O is implicated, the specific callers are quantified — one `PATCH` per Sentence is the loudest, and its cadence is a deliberate choice made in ticket 10 that would be re-opened rather than assumed. _Not implicated; the run that survived 650s made exactly the same requests as the one that died._
- [ ] Whatever is concluded, ADR 0003 gains a follow-up section: it is the document that claims a single continuous element solves background playback, and standalone mode is the production condition.
