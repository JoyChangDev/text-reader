# HLS background playback spike — raw results

Evidence behind [ADR 0003](../../docs/adr/0003-hls-continuous-playback.md). The spike
itself lived at `public/hls-spike/` on branch `hls-spike`, which is deleted; this file is
what survives it.

Instrument: a static 600s VOD playlist (21 × 30s fMP4/AAC segments) plus a 120-cue
metadata VTT, in a plain static page with **no chunk-advance code of any kind**. A 1s
heartbeat recorded wall-clock time against `audio.currentTime`, logging a `JS GAP` line
whenever a tick arrived more than 2.5s late. Every log line carries `t=` so the ratio is
recoverable from any two entries, which is what made both runs readable despite no `JS
GAP` line ever appearing.

Device: physical iPhone, Vercel preview deployment over HTTPS.

## Run 1 — Safari tab (`standalone=false`)

```
23:08:32  t=   0.0s  --- page load (standalone=false) ---
23:08:32  t=   0.0s  suspend
23:08:32  t=   0.0s  pageshow
23:08:40  t=   0.0s  play
23:08:40  t=   0.0s  waiting
23:08:41  t=   0.0s  playing
23:08:42  t=   1.4s  visibility -> hidden
23:08:54  t=  12.7s  stalled
23:15:10  t= 388.7s  visibility -> visible
```

Hidden 23:08:42 (t=1.4s) → visible 23:15:10 (t=388.7s): **388s wall, 387.3s audio, 99.8%**,
12 segment boundaries crossed.

## Run 2 — standalone PWA (`standalone=true`)

```
23:18:17  t=   0.0s  --- page load (standalone=true) ---
23:18:17  t=   0.0s  suspend
23:18:17  t=   0.0s  pageshow
23:18:25  t=   0.0s  play
23:18:25  t=   0.0s  waiting
23:18:25  t=   0.0s  playing
23:18:27  t=   1.3s  visibility -> hidden
23:18:30  t=   4.2s  stalled
23:24:07  t= 341.3s  visibility -> visible
23:24:21  t= 355.4s  visibility -> hidden
23:24:22  t= 356.3s  visibility -> visible
23:24:25  t= 359.7s  pause
```

Hidden 23:18:27 (t=1.3s) → visible 23:24:07 (t=341.3s): **340s wall, 340.0s audio, 100.0%**,
11 segment boundaries crossed. The trailing foreground entries also reconcile (14s wall /
14.1s audio, then 1s / 0.9s), so the clock held on both sides of the transition.

Reported `active cue` at the end of this run: `s-71`. Cue `s-71` spans 355–360s and the
final `t` was 359.7s — exact, after 71 cues and 11 segments, with no correction code in
the page.

## Run 3 — the real app, Safari tab, EVENT playlist — 2026-08-11

The first run of any of this against the thing the spike could not serve: a **growing EVENT
playlist**, in the real app, on R2 with segments served by the Cloudflare Worker. Book
`f844b066…`, 4,962 Chunks, 11 generated before the run began.

Instrument: the app's own `backgroundDiagnostics` ring buffer, plus R2 object write
timestamps read with `npm run inspect-r2`. There is no 1s heartbeat here — `reconcile`
fires only on foregrounding — so the ratio is recoverable from one pair of entries rather
than continuously.

```
12:41:58.068Z  mediaSessionRegistration {"supported":true}
12:43:03.450Z  visibilitychange {"visibilityState":"hidden"}
12:54:34.589Z  focus / reconcile {"audioPaused":false,"audioCurrentTime":999.0944144263315}
12:54:34.594Z  focus / reconcile {"audioPaused":false,"audioCurrentTime":999.0991650096523}
12:54:34.607Z  visibilitychange visible / reconcile {"audioPaused":false,"audioCurrentTime":999.1117754039351}
```

Hidden 12:43:03 → visible 12:54:34: **691s backgrounded, still playing on return.**
`audioPaused: false`, and the three reconciles 18ms apart advance 999.0944 → 999.0991 →
999.1117, so the element was progressing at the moment it was read rather than merely
holding a number.

**The ratio is not recoverable for this run**, because `reconcile` fires only on foregrounding
and nothing captured `currentTime` at the moment of locking. `t=999s` is the position in the
playlist, not the distance travelled. An earlier draft of this entry inferred a ~1.3× playback
speed from it by assuming playback began at `t=0`; run 5 measures the speed directly at **1.0×**,
so that inference was wrong and is withdrawn. Taking 1.0×, the 691s backgrounded is ~691s of
media at 21.6s average segment duration — **roughly thirty segment boundaries crossed
unattended.**

**Generation was still in progress throughout, which is the part the spike could not
test.** R2 gained **62 objects (31 Chunks) after the screen was locked** — the Book went
from 11 generated Chunks to 55 across the session. So the playlist grew while backgrounded
and the media stack kept discovering segments from it, which is the EVENT-playlist question
ADR 0003 left open.

Sentence highlighting kept up for the whole run (Listener-reported on return). The
look-ahead advancing at all is independent corroboration: it is anchored to the Sentence
ordinal the `cuechange` handler sets, so 44 newly generated Chunks cannot happen unless
cues were activating.

**Run 3 is Safari-tab only.** The standalone PWA remains unmeasured; see the runs above for
why that is recorded separately.

### The old failure, for contrast

Same ring buffer, 2026-08-09, before the R2 cutover:

```
17:39:53.376Z  visibilitychange hidden
17:41:15.970Z  reconcile {"audioPaused":true,"audioCurrentTime":368.11517473798773}
17:41:28.066Z  visibilitychange hidden
17:45:11.371Z  reconcile {"audioPaused":true,"audioCurrentTime":368.11517473798773}
```

Two separate background periods, and `audioCurrentTime` is identical to fourteen decimal
places across both, with `audioPaused: true`. That is playback stopped, not slowed — the
symptom these phases were built to remove, captured in the same instrument that recorded
run 3 passing.

## Run 4 — the real app, standalone PWA, EVENT playlist — 2026-08-11

Same app, same Book, same session as run 3, launched from the home screen instead of in a
Safari tab. **It fails, and not in the way the phase was watching for.**

```
13:04:45.630Z  mediaSessionRegistration {"supported":true}
13:05:43.864Z  visibilitychange {"visibilityState":"hidden"}
   ( nothing at all for 111 seconds )
13:07:35.015Z  mediaSessionRegistration {"supported":true}
```

The Listener reports: playback started 13:04, screen locked 13:05, **audio stopped at 13:07
while the screen was still locked**, and only then did they unlock.

**The gap is the finding.** No `pagehide`, no `visibilitychange visible`, no `reconcile` —
the page never ran another line. The final entry is a fresh `mediaSessionRegistration`, which
is a new mount, not a resumption. Phase 1.8 ticket 03 added the `pagehide` flush precisely
for a process killed while hidden; it did not fire either.

**Backgrounded playback was working right up to the kill.** From the deployment's request
log, over the 101 seconds between locking and death:

```
13:06:00 → 13:07:25   PATCH /api/library  × 15      one per Sentence — the position was advancing
13:06:07, :41, :56, 13:07:21   POST /api/audio-chunks   generation kept running
13:06:11, :53         GET  playlist.m3u8              polled ~42s apart, matching TARGETDURATION
13:07:27              GET  /book/<bookId>             a whole new document — the relaunch
```

R2 gained **10 objects (5 Chunks) after the screen was locked**, so the playlist was still
growing and the look-ahead was still ahead of the playhead. Nothing about the EVENT playlist,
the Worker, or the media stack was failing when the process died.

### What separates run 4 from runs 2 and 3

|       | context        | playlist      | what the page did while hidden | outcome          |
| ----- | -------------- | ------------- | ------------------------------ | ---------------- |
| Run 2 | standalone PWA | static VOD    | **nothing at all**             | 340s, passed     |
| Run 3 | Safari tab     | growing EVENT | ~1 request every 2–6s          | 691s, passed     |
| Run 4 | standalone PWA | growing EVENT | ~1 request every 2–6s          | **101s, killed** |

Run 2 rules out "a standalone PWA cannot play in the background" — it did, for 340s. Run 3
rules out "the app's background behaviour is fatal" — the same behaviour survived 691s in a
tab. Only the combination fails, and the variable the two passing runs do not share is that
run 2's page was inert while runs 3 and 4 make continuous network requests.

So the hypothesis the next run should attack: **a standalone PWA that keeps doing network I/O
while backgrounded is reclaimed far sooner than an inert one, and a Safari tab is more
tolerant of the same behaviour.** See phase 1.10 ticket 11.

## Run 5 — standalone PWA again, and run 4 does not reproduce — 2026-08-11

Ticket 11 step 1: repeat run 4 unchanged and find out whether the 101s kill is a property of
the app or of that minute. Battery 34%, Low Power Mode off.

```
13:28:18.805Z  visibilitychange {"visibilityState":"hidden"}
13:39:08.918Z  focus / reconcile {"audioPaused":false,"audioCurrentTime":1897.000872622962}
13:39:08.922Z  focus / reconcile {"audioPaused":false,"audioCurrentTime":1897.0033665814167}
13:39:08.924Z  visibilitychange visible / reconcile {"audioPaused":false,"audioCurrentTime":1897.0058601111223}
```

Hidden 13:28:18 → visible 13:39:08: **650s backgrounded, still playing**, `audioPaused: false`
and advancing across the three reads. **R2 gained 60 objects (30 Chunks) in that window**, so
generation ran the whole time and the playlist grew throughout.

**Run 4 did not reproduce.** Same device, same Book, same standalone PWA, same afternoon, 21
minutes later: 650s instead of 101s.

**This run also fixes the playback speed for runs 3–5.** `currentTime` was 1239.725 at 13:27:57
and 1897.006 at 13:39:08 — 657s of media against ~668s of wall clock, so **1.0×**, not the 1.3×
run 3's entry inferred. That inference assumed playback began at `t=0`; it did not, because the
session resumed from a stored position.

### A third window, which is not a run

Between runs 4 and 5 the log shows `hidden 13:07:43` → `visible 13:27:57` with
`audioPaused: true` and `audioCurrentTime: 1239.725`. That is 1214s backgrounded **with the page
still alive** — `reconcile` fired, and there is no intervening `mediaSessionRegistration`, so no
new mount and no kill.

It is not a playback run: R2 gained **zero** objects between 13:07:43 and 13:28:18 (the `--since`
counts for both moments are identical at 60), so nothing was generating and nothing was playing.
Playback was stopped for the whole window. It is recorded only because it is a third consecutive
20 minutes in which the standalone PWA was **not** reclaimed.

## Reading notes

**`stalled` is noise here.** It fired ~12s and ~4s into backgrounding in the two runs, and
in both cases audio then played on for another 5–6 minutes. It appears to be Safari's
fetch going idle once it has buffered enough, not an interruption. Do not read it as a
playback failure.

**No `JS GAP` line appeared in either run, and that is the finding.** In run 2 the page
stayed alive for 18s after returning and wrote three further entries, so a freeze longer
than 2.5s would certainly have been logged. Run 1 independently shows JS alive 12s into
the background (the `stalled` entry). The assumption these phases were built on — that
iOS freezes a hidden page's JS and so `handleEnded` never runs — is not what is happening.
See ADR 0003 for the revised failure condition and what follows from it.

## Not covered

Static VOD playlist rather than the EVENT playlist progressive generation needs;
same-origin VTT rather than audio on Vercel Blob (CORS + `crossorigin`); iOS only. The
runs show `activeCues` is correct whenever read, not that `cuechange` fires while
backgrounded.
