# 04 — Harden Phase 1.8's background reconciliation

**What to build:** Root cause confirmed via a real-device diagnostic log capture (see Comments): `audio.paused` alone can't distinguish genuine playback from a `.play()` call that flipped it to `false` right as backgrounding suspended the tab before any audio actually started - the log showed `audioCurrentTime: 0` on every reconciliation checkpoint across multiple background/foreground cycles, despite `audioPaused: false` (so no correction ever triggered). The reconciliation checkpoint in `useBookPlayer` now also detects this "stalled" case - `wantsToPlay` true, `audio.paused` false, `audio.currentTime` still exactly `0`, and more than a short grace period elapsed since the last `.play()` attempt (ruling out a chunk that only just started) - and retries `.play()` once, logging the retry's rejection reason (if any) for further diagnosis.

**Blocked by:** 03 (done - real-device diagnostic log gathered and reviewed)

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] Diagnostic log data has been gathered from a real-device repro session (background the app for a while on iOS Safari Home Screen, return) and reviewed.
- [x] Root cause identified and written up under Comments.
- [x] A `stalled` check added to the reconciliation checkpoint: `wantsToPlay && !audio.paused && audio.currentTime === 0 && (time since last .play() attempt) > STALL_GRACE_MS (2s)`.
- [x] On detecting a stall, the checkpoint retries `audio.play()` once and resets the last-attempt timestamp (so it doesn't immediately re-flag the retry itself before giving it a chance).
- [x] A `.play()` rejection from the retry is caught and logged (`stallRetryFailed`, with the error's `name`/`message`) rather than becoming an unhandled rejection - this is itself diagnostic: a logged `NotAllowedError` would confirm the "iOS blocks non-gesture `.play()`" theory as the deeper cause.
- [x] The existing `reconcile` log entry gains a `stalled` boolean field so future log captures show whether this path fired.
- [x] A chunk within its normal startup grace period (just loaded, hasn't had time to begin producing audio yet) is not falsely flagged as stalled.
- [x] Genuinely-progressed audio (`currentTime` non-zero) is never flagged as stalled, regardless of elapsed time.
- [x] Existing `useBookPlayer`/`AudioPlayer` tests pass unchanged; new tests cover the retry-triggers, grace-period, and genuine-progress cases.

## Comments

- 2026-08-01: Joy captured a real diagnostic log from an actual repro (backgrounded the app on iOS Safari Home Screen, returned, playback had stopped). Every `reconcile` entry showed `"audioPaused":false,"audioCurrentTime":0` - across two separate background/foreground cycles, several seconds apart each time. Also notable: a `mediaSessionRegistration` event fired _while still hidden_ between the two cycles, implying some JS did execute in the background (consistent with `useMediaSession`'s registration effect re-running when `pause`'s identity changes on a ping-pong role flip) - so this isn't simply "JS never runs in the background at all," it's specifically that a `.play()` call issued around backgrounding time can silently never produce audio while still flipping the `.paused` flag. This is now handled (see What to build above). Not yet confirmed whether the retry actually recovers real audio in practice, or whether `.play()` gets rejected with `NotAllowedError` (iOS blocking a non-gesture-triggered play) - the newly-added `stallRetryFailed` log entry will show this on the next repro. If retries keep failing, the next escalation would be exploring whether the retry needs to happen from inside the MediaSession `play` action handler specifically (which iOS may trust more than an arbitrary internal `.play()` call) rather than from the visibilitychange-triggered reconciliation path directly - flagged here for a future round if the current fix turns out to be insufficient.
