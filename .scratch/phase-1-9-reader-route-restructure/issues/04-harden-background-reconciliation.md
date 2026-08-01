# 04 — Harden Phase 1.8's background reconciliation

**What to build:** Not yet fully specified. Phase 1.8's `visibilitychange`/MediaSession reconciliation (`useBookPlayer`) is still producing the originally reported symptoms (stops after a while backgrounded; play/pause state or Sentence highlight desyncs from actual audio on return) even after shipping. The fix can't be scoped correctly without knowing which of several plausible causes is actually happening on-device: `visibilitychange` under-firing in iOS Home Screen standalone mode, MediaSession registration silently failing/detaching, the reconciliation checkpoint running but computing a wrong correction, or a same-process case that's actually fine and everything remaining is really the process-kill case ticket 02 addresses.

**Blocked by:** 03 (need a round of real-device testing with the diagnostic panel deployed before this can be scoped)

**Status:** needs-info

- [ ] Diagnostic log data has been gathered from at least one real-device repro session (background the app for a while on iOS Safari Home Screen, return, capture the panel's log) and reviewed.
- [ ] Root cause identified and written up here (append under Comments) before acceptance criteria for the actual fix are filled in.
- [ ] _(Remaining criteria to be added once root cause is known.)_

## Comments
