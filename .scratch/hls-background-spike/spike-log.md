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
