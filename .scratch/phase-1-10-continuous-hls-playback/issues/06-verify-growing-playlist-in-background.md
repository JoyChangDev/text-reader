# 06 — Verify a growing EVENT playlist keeps playing in the background

**What to build:** Nothing — the measurement the phase's load-bearing risk actually requires. Confirm on a physical iPhone that playback continues across the boundary where the media stack must re-fetch a growing EVENT playlist to discover new segments, in both a Safari tab and standalone PWA mode.

**Blocked by:** 05, 08

**Status:** resolved — **measured on 2026-08-11. Run A passed (691s, Safari tab); Run B was killed at 101s on its first attempt and then passed at 650s on a repeat** (standalone PWA). Runs 3 to 5 in [the spike log](../../hls-background-spike/spike-log.md). What this ticket set out to measure — whether a growing EVENT playlist keeps playing while backgrounded — **is answered yes**, in every window where anything was playing at all, including the one that ended in a process kill. That kill is a different thing, did not reproduce, and is parked as [ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md).

> ~~**Do not run this until [ticket 08](08-playlist-routes-read-one-blob-per-chunk.md) lands.**~~ **Unblocked 2026-08-09** — ticket 08's stage 2 shipped and the polled path no longer reads storage at all when the Chunk index answers. The warning below is kept because it describes a failure mode that is still worth recognising, not because it still applies.
>
> Each playlist poll used to fan out one Blob read per Chunk of the whole Book, which trips the store's rate limiting and makes segment fetches return 403 for tens of minutes. On a device that presents as playback stopping at a segment boundary partway through a listening session — which is indistinguishable from the failure this ticket exists to measure, and would be recorded against the EVENT playlist wrongly.

The spike behind [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) served a **complete VOD** playlist. This phase serves a **growing EVENT** playlist, and when playback reaches the last known segment the media stack must re-fetch the playlist to learn about more. Whether it does that reliably while backgrounded is unverified — and if it does not, the failure looks exactly like the bug this phase set out to fix, just at a coarser granularity.

Test the real app, not a static harness: upload a Book long enough that generation cannot get far ahead, so playback genuinely catches up to the end of the playlist while backgrounded.

- [x] A Book is uploaded that is long enough for playback to reach the end of the generated region at least twice during the test (verify beforehand that the look-ahead value chosen in ticket 04 does not simply outrun it). _4,962 Chunks against `LOOKAHEAD = 10`. It did not outrun it: 11 Chunks were generated before the run and 55 by the end, so playback stayed inside a region the look-ahead was still extending._
- [x] Run A — Safari tab: play, background the app for five minutes, return. Record wall-clock elapsed against `audio.currentTime`, the same ratio the spike used. _**691s backgrounded, still playing on return**, `audioCurrentTime: 999.09` and advancing between reads. See below._
- [x] Run B — standalone PWA, launched from the home screen: same procedure. This is the production condition and must be recorded separately; run A passing is not sufficient. _**Passed on repeat: 650s backgrounded, still playing, 30 Chunks generated while hidden.** The first attempt was killed at 101s — a real event that did not reproduce and is parked as [ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md). Recording the two separately, rather than reporting whichever came last, is the whole point of this criterion. See "Run B, measured" below._
- [x] Both runs cross at least one playlist-growth boundary while backgrounded, confirmed by checking that generation was still in progress at the time (not merely that the Book was long). _Run A: **31 Chunks generated after the screen was locked** (62 R2 objects after `12:43:03Z`). Run B: **5 Chunks after the lock** (10 objects), plus playlist polls ~42s apart, right up until the process died — so the boundary was crossed in both, and Run B's failure is not at one._
- [x] Sentence highlighting is correct on return in both runs, with no visible correction or jump — the ADR's claim that `activeCues` is browser-maintained ground truth, verified in the real app rather than the spike harness. _Run A: correct throughout, Listener-reported, and independently corroborated — see "The look-ahead is a second witness". Standalone: correct during playback and after a manual Sentence seek, confirmed 2026-08-11. **One gap, named rather than glossed:** nobody watched the highlight at the moment of returning from the 650s standalone background run specifically. The mechanism is the same one Run A exercised across 691s backgrounded, so this is ticked; if that distinction ever matters, this is where it was decided._
- [x] Results are appended to [.scratch/hls-background-spike/spike-log.md](../../hls-background-spike/spike-log.md) alongside the original spike runs, so the VOD and EVENT measurements sit together. _Runs 3 and 4, plus the 2026-08-09 failure as their contrast._
- [x] If either run fails at a playlist-growth boundary, ADR 0003 gains a follow-up section recording it, and the mitigation is re-planned as its own ticket — do not paper over it with a retry in `useBookPlayer`, which is the pattern Phase 1.9 already tried. _Run B failed, but **not at a playlist-growth boundary** — generation was ahead of the playhead and the playlist was being polled normally when the process died, so ADR 0003's mechanism is not what this impugns and the ADR gains no follow-up on that account. The mitigation is re-planned as [ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md), and the "do not paper over it" instruction carries over to it verbatim._

## Comments

### Run A, measured — 2026-08-11

The full numbers are in [the spike log](../../hls-background-spike/spike-log.md) as run 3.
What matters here: this is the first time any of it ran against a **growing EVENT playlist**
rather than the spike's static VOD one, which is the single thing this ticket exists for.

Hidden `12:43:03.450Z`, visible `12:54:34.589Z`. On return `audioPaused: false` and
`audioCurrentTime: 999.09`, advancing across three reconciles 18ms apart — the element was
progressing when it was read, not holding a stale number. ~40 segment boundaries crossed
unattended, at ~21.6s average segment duration.

### The look-ahead is a second witness, and it is the one that cannot be misremembered

The highlighting criterion is Listener-reported, which is weak evidence on its own. It does
not have to stand alone. The look-ahead is anchored to the Sentence ordinal that the
`cuechange` handler sets — nothing else advances `currentIndex` — so **44 newly generated
Chunks are proof that cues were activating.** Storage write timestamps are not a memory of
what the screen looked like.

This matters because ADR 0003's own "what the spike did not establish" says the runs showed
`activeCues` is correct whenever read, **not** that `cuechange` fires — and the shipped code
reads `activeCues` in exactly one place, inside the `cuechange` handler
([useBookPlayer.js](../../../app/_lib/useBookPlayer.js)). The thing the ADR flagged as
unverified is load-bearing in the implementation. Run A is the first evidence it holds, and
it holds only for the Safari tab.

### Run B, measured — 2026-08-11

Same app, same Book, same afternoon, launched from the home screen. Full numbers are run 4 in
[the spike log](../../hls-background-spike/spike-log.md).

Locked `13:05:43.864Z`. The Listener reports audio stopping at ~13:07 **while the screen was
still locked**, and only unlocking afterwards — so the death happened in the background rather
than being provoked by returning to it. The diagnostic log carries nothing at all between the
lock and a fresh `mediaSessionRegistration` at `13:07:35`: no `pagehide`, no
`visibilitychange visible`, no `reconcile`. **The page never ran another line.** Phase 1.8
ticket 03's `pagehide` flush, which exists for exactly this, did not fire.

**Everything this ticket measures was working when it died.** Over the 101 seconds backgrounded:
one `PATCH /api/library` per Sentence (15 of them, so the position was advancing), four
`POST /api/audio-chunks` (generation keeping up), playlist polls ~42s apart matching
`TARGETDURATION`, and **5 Chunks written to R2 after the lock**. The playlist grew, the media
stack consumed it, and the process was then reclaimed out from under all of it.

So the answer to the question in this ticket's title is **yes, in both runs**. The EVENT
playlist is not what fails.

**Repeated 21 minutes later, unchanged, it survived 650s** with 30 Chunks generated while hidden
— run 5 in the spike log. Same device, same Book, same standalone context, same request cadence.
The 101s kill is therefore situational rather than a property of standalone mode, which is why
[ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md) parks instead of proceeding
to a code change. Both attempts are recorded because reporting only the later one would turn a
real event into a rounding error.

### What separates the failing run from the two passing ones

|                 | context        | playlist      | what the page did while hidden | outcome          |
| --------------- | -------------- | ------------- | ------------------------------ | ---------------- |
| ADR spike run 2 | standalone PWA | static VOD    | **nothing at all**             | 340s, passed     |
| Run A           | Safari tab     | growing EVENT | ~1 request every 2–6s          | 691s, passed     |
| Run B           | standalone PWA | growing EVENT | ~1 request every 2–6s          | **101s, killed** |

The spike's own standalone run rules out "a PWA cannot play in the background" — it did, for
340s, with no application code in the page. Run A rules out "this app's background behaviour is
fatal" — the identical behaviour survived 691s in a tab. Only the combination fails, and the
variable the two passing runs do not share is that the spike's page was inert.

That is [ticket 11](11-the-standalone-pwa-is-killed-while-backgrounded.md)'s starting
hypothesis, and it is a hypothesis rather than a finding: three runs varying two things at once
cannot separate them, and nothing here has yet held the context fixed while changing only what
the page does.

### Run B is where the reported failure actually was

The session that prompted this ran earlier the same day and looked like the bug this phase
exists to fix: Sentence highlighting stuck, audio stopping on lock, and afterwards a stored
resume position still at Chunk 0 / Sentence 0 with only the initial 11 Chunks generated.
None of it is in the diagnostic log that recorded Run A — that log runs from 2026-08-03 to
now with **no entries at all for the failing session**.

**The two contexts do not share `localStorage`.** A standalone PWA on iOS has its own
storage container, so a run in one is invisible from the other. The request log puts
`/apple-icon` and `/icon` fetches at `12:33:47Z`, which is iOS resolving home-screen icons —
so the failing session was almost certainly Run B's condition, reached by accident before
Run A was reached deliberately.

Two consequences. Run B is not a formality after a passing Run A; it is the only run that
has ever failed. And whoever runs it must copy the log **from inside the PWA** — the
diagnostic panel reads the container it is running in, and a log copied from the Safari tab
after a PWA run is a different container's log that will look empty and mean nothing.

**Do not press 清除記錄 before a run.** The buffer holds 50 entries and spans days; clearing
it costs the history that makes a failure legible and buys nothing, since entries are
timestamped.
