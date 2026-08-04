# 06 — Verify a growing EVENT playlist keeps playing in the background

**What to build:** Nothing — the measurement the phase's load-bearing risk actually requires. Confirm on a physical iPhone that playback continues across the boundary where the media stack must re-fetch a growing EVENT playlist to discover new segments, in both a Safari tab and standalone PWA mode.

**Blocked by:** 05

**Status:** ready-for-human

The spike behind [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md) served a **complete VOD** playlist. This phase serves a **growing EVENT** playlist, and when playback reaches the last known segment the media stack must re-fetch the playlist to learn about more. Whether it does that reliably while backgrounded is unverified — and if it does not, the failure looks exactly like the bug this phase set out to fix, just at a coarser granularity.

Test the real app, not a static harness: upload a Book long enough that generation cannot get far ahead, so playback genuinely catches up to the end of the playlist while backgrounded.

- [ ] A Book is uploaded that is long enough for playback to reach the end of the generated region at least twice during the test (verify beforehand that the look-ahead value chosen in ticket 04 does not simply outrun it).
- [ ] Run A — Safari tab: play, background the app for five minutes, return. Record wall-clock elapsed against `audio.currentTime`, the same ratio the spike used.
- [ ] Run B — standalone PWA, launched from the home screen: same procedure. This is the production condition and must be recorded separately; run A passing is not sufficient.
- [ ] Both runs cross at least one playlist-growth boundary while backgrounded, confirmed by checking that generation was still in progress at the time (not merely that the Book was long).
- [ ] Sentence highlighting is correct on return in both runs, with no visible correction or jump — the ADR's claim that `activeCues` is browser-maintained ground truth, verified in the real app rather than the spike harness.
- [ ] Results are appended to [.scratch/hls-background-spike/spike-log.md](.scratch/hls-background-spike/spike-log.md) alongside the original spike runs, so the VOD and EVENT measurements sit together.
- [ ] If either run fails at a playlist-growth boundary, ADR 0003 gains a follow-up section recording it, and the mitigation is re-planned as its own ticket — do not paper over it with a retry in `useBookPlayer`, which is the pattern Phase 1.9 already tried.

## Comments
