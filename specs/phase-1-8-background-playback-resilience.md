# Phase 1.8 — Background Playback Resilience

_Status: done — all three tickets resolved. The symptoms it set out to fix outlived it; see Phase 1.9 and, for the fix that finally held, Phase 1.10_

## Problem Statement

The reader is a web app with no native wrapper, so playback lives entirely in two `<audio>` elements driven by React state in `useBookPlayer` (`app/_lib/useBookPlayer.js`). That state (`wantsToPlay`, `currentIndex`, `activeSentenceIndex`, `activeIsPrimary`) is only ever updated from effects reacting to normal foreground events — `onEnded`, `onTimeUpdate`, explicit play/pause clicks. Nothing in the app reacts to the page being backgrounded or foregrounded at all: there is no `visibilitychange`/`pagehide` handling, and no MediaSession integration to tell the OS this is legitimate media playback.

In practice, when a Listener switches to another app (Threads, X, Plurk, etc.) mid-playback:

- Playback sometimes stops outright, with no clear reason from the Listener's side.
- Returning to the tab shows the play/pause button in a state that doesn't match what's actually happening — sometimes it reports playing when audio is silent, sometimes it silently resumes, sometimes it doesn't.
- Both `<audio>` elements (the ping-pong active/standby pair — see ticket 05 of Phase 1.5) have been observed playing at once.
- The active-Sentence highlight has been observed stuck on Sentence A while audio is actually partway into the next Chunk (A+1), then jumping back and replaying A — a visible, audible desync between what's highlighted and what's heard.

None of this is a data-loss bug on its own, but the debounced resume-position write (`persistResumePosition`, 400ms trailing) also has no flush point tied to backgrounding — if the OS fully kills the tab's process (rather than just suspending it) while that debounce is pending, the last few seconds of reading position never get saved.

## Solution

Background playback becomes an explicitly handled state, not an accident of whatever the OS happens to do to a hidden tab:

- **Keep playing across an app switch when the OS allows it.** The app registers a MediaSession (`play`/`pause` action handlers wired to the existing `play()`/`pause()` functions, plus `metadata` carrying the Book title) so the OS treats this as legitimate media playback rather than an arbitrary background tab — the same mechanism that gets a lock-screen/notification play-pause control on mobile.
- **Degrade cleanly if the OS kills it anyway.** A single reconciliation checkpoint runs whenever the page becomes visible again (`visibilitychange` → `visible`, and `focus` as a fallback): it reads the _real_ `<audio>` element state (which element is actually unpaused, its `currentTime`) as the source of truth and corrects React state (`isPlaying`, `activeSentenceIndex`, `currentIndex` if a chunk boundary was crossed while hidden) to match — rather than trusting whatever state was left over from before backgrounding.
- **Never let both elements play at once.** An invariant — at most one of the primary/secondary `<audio>` elements is ever unpaused — is enforced at that same reconciliation checkpoint and after every `play()` call the hook makes, unconditionally pausing the other element. This is a backstop against races (stale `play()` promises resolving late, effects re-running against a stale `activeIsPrimary`), not just a fix for one specific race.
- **Don't lose reading position to a hard kill.** `visibilitychange` → `hidden` (and `pagehide`) triggers an immediate flush of `persistResumePosition`, bypassing the existing 400ms debounce, so the last known (Chunk, Sentence) is saved before a background tab has any chance of being terminated.

MediaSession is scoped to `play`/`pause` + metadata only for this phase — no lock-screen next/previous-chunk, no scrub/position-state — since those are unrelated to the reported bug and are a distinct feature to design later if wanted.

## User Stories

1. As a Listener, I want playback to keep going when I switch to another app to check something, so that I don't lose my place in the narration for a quick interruption.
2. As a Listener, I want a lock-screen/notification play-pause control while listening, so that I can pause without switching back to the browser tab.
3. As a Listener, if the OS stops my playback while I'm in another app, I want the reader to show an accurate paused state when I come back, so that the play button always matches what's actually happening.
4. As a Listener, I never want to hear two segments of narration overlapping, so that returning to the app doesn't produce a confusing audio glitch.
5. As a Listener, I want the highlighted Sentence and the audio I'm hearing to always refer to the same spot, so that switching apps and back never leaves the transcript pointing at the wrong place.
6. As a Listener, I want my reading position saved right before the app is backgrounded, so that even if the browser fully kills the tab while I'm elsewhere, I don't lose more than a moment's progress.

## Implementation Decisions

### MediaSession registration

- A new effect in `useBookPlayer` (or a small hook it composes, e.g. `useMediaSession`) calls `navigator.mediaSession.setActionHandler('play', play)` / `setActionHandler('pause', pause)`, guarded by an `'mediaSession' in navigator` check (not all browsers support it). Handlers are re-registered if `play`/`pause` identities change, and cleared (`setActionHandler(action, null)`) on unmount.
- `navigator.mediaSession.metadata = new MediaMetadata({ title })` is set once the Book's `title` is available (title is already a prop on `AudioPlayer` — threaded down to `useBookPlayer` or set from `AudioPlayer` directly, whichever keeps `useBookPlayer` from taking on a prop it doesn't otherwise need).
- `navigator.mediaSession.playbackState` is kept in sync (`'playing'` / `'paused'`) alongside `isPlaying`, since some browsers use it as a hint for their own suspend heuristics.
- No `previoustrack`/`nexttrack`/`seekto`/`setPositionState` handlers are added — out of scope for this phase.

### Foreground/background reconciliation

- A single `visibilitychange` listener (attached once, at the `useBookPlayer` level since that's where the audio refs and all relevant state live) fires the reconciliation logic when `document.visibilityState === 'visible'`; a `focus` listener calls the same function as a fallback for browsers/contexts where `visibilitychange` under-fires.
- Reconciliation reads `activeAudioRef.current.paused` and `.currentTime` as ground truth:
  - If the active element is actually playing but `wantsToPlay`/`isPlaying` says otherwise (or vice versa), React state is corrected to match the element, not the other way around.
  - If `.currentTime` falls outside every span in `currentSentenceSpans`, `activeSentenceIndex` is recomputed the same way `handleTimeUpdate` already does (reusing that lookup, not duplicating it), so a Sentence boundary crossed while `onTimeUpdate` wasn't firing (tab hidden/throttled) is caught immediately on return rather than waiting for the next natural `timeupdate` tick.
  - If `onEnded` never fired for a chunk boundary that was in fact crossed while hidden (audio element's `src` no longer matches `currentIndex`'s expected chunk, or the standby element is now the one holding live audio), the same chunk-advance path `handleEnded` already uses is invoked rather than introducing a second advance mechanism.
- This reconciliation function is the single place all of the above corrections happen — no duplicate ad hoc fix-ups scattered across other effects.

### Single-active-audio invariant

- A small helper (e.g. `enforceSingleActiveAudio()`) unconditionally pauses whichever of `primaryAudioRef`/`secondaryAudioRef` is _not_ the current `activeAudioRef`, regardless of what state anything thinks that element should be in.
- Called from two places: at the end of the reconciliation function above, and immediately after every `audio.play()` call the "load and play" effect makes (currently [useBookPlayer.js:211](app/_lib/useBookPlayer.js#L211) and [useBookPlayer.js:213](app/_lib/useBookPlayer.js#L213)) — covering both the backstop case (something already went wrong) and the moment-of-play case (catching a stale second `play()` before it can produce audible overlap).
- This is intentionally a blanket invariant, not a fix targeted at one specific race — the standby element has no legitimate reason to ever be unpaused outside the brief preload-into-standby path, which never calls `.play()`.

### Background flush of resume-position persistence

- The same effect that attaches the `visibilitychange` listener also fires `persistResumePosition(currentIndex, activeSentenceIndex)` immediately (bypassing `RESUME_PERSIST_DEBOUNCE_MS`) when `document.visibilityState === 'hidden'`, and again on `pagehide` as a fallback for the case where `visibilitychange` doesn't fire before the process is torn down.
- The existing debounce/coalescing logic (`lastPersistedRef`, the `setTimeout` in the persistence effect) is left untouched for the normal foreground case — this only adds an unconditional flush at the two backgrounding-adjacent events, using the same `persistResumePosition` function so there's one persistence code path, not two.

## Testing Decisions

Tests target `useBookPlayer` directly where possible (it owns all the state and refs involved), falling back to `AudioPlayer.test.jsx`'s existing fake-`<audio>`-element harness (`window.HTMLMediaElement.prototype.play`/`pause` mocks, `data-testid="audio-element"`/`audio-element-standby`, simulated `timeupdate`/`ended`) for anything that needs to observe both elements at once:

- Simulating `document.visibilityState = 'hidden'` + dispatching `visibilitychange` immediately calls `persistResumePosition` (asserted via the existing `libraryPatchCalls()` helper in `AudioPlayer.test.jsx`) without waiting for the 400ms debounce.
- Simulating the active element having advanced past every span in `currentSentenceSpans` (as if `timeupdate` was missed while hidden), then dispatching `visibilitychange` → visible, updates `activeSentenceIndex` to match `currentTime` without needing a subsequent real `timeupdate` event.
- Simulating both `<audio>` elements' `paused` reporting `false` at once, then dispatching `visibilitychange` → visible, results in exactly one of the two elements' `pause()` being called (the non-active one).
- Calling `play()` (or simulating the natural chunk-advance path) never leaves the standby element's `play()` uncalled-but-somehow-unpaused — i.e. `enforceSingleActiveAudio()` is asserted as invoked (or its effect observed) on every `play()` path, not just the reconciliation path.
- A `useMediaSession`-style unit test (or `AudioPlayer.test.jsx` addition, guarding `navigator.mediaSession` presence): `setActionHandler('play', ...)`/`('pause', ...)` are registered and invoking them calls through to the same `play`/`pause` the on-screen button uses; handlers are cleared on unmount.
- Existing `AudioPlayer.test.jsx`/`useBookPlayer` coverage (look-ahead fetch, ping-pong preload, ordinary play/pause, Sentence-click seeking) is unaffected — none of the above changes alter behavior while the page stays visible throughout.

## Out of Scope

- MediaSession `previoustrack`/`nexttrack`/`seekto`/`setPositionState` (lock-screen chunk navigation or scrub bar).
- A dedicated root-cause investigation into the exact prior mechanics of the "highlight lags, audio jumps ahead, then rewinds" symptom — it's treated as a downstream consequence of the missing reconciliation this phase adds, verified by testing rather than diagnosed in isolation. If it persists after this phase ships, that becomes its own follow-up ticket.
- Any native app wrapper, service worker, or platform-specific background-audio API (e.g. `Audio Session` on iOS Safari beyond what MediaSession itself provides) — this reader has no native wrapper today (confirmed: no Capacitor/Cordova/Electron/Tauri/React Native in `package.json`) and this phase stays web-only.
- Any change to chunk fetching, TTS generation, or the look-ahead buffer logic (Phase 1.5 ticket 05) beyond what the reconciliation function reuses from `handleEnded`/`handleTimeUpdate`.

## Further Notes

- The core principle this phase applies: **the real `<audio>` elements are the only source of truth once the page has been hidden.** React state is a cache of that truth that's reliable while the tab stays foregrounded (because every state-changing event fires normally) and unreliable the moment the tab is hidden (because the OS may suspend, throttle, or kill it without telling the page in an orderly way). Every decision above — reconciliation-on-visible, the single-active-audio invariant, the backgrounding flush — is a specific application of that principle, not independent patches.
- MediaSession's secondary benefit (beyond lock-screen controls) is that declaring a page as playing media is itself a signal several mobile browsers use when deciding whether to suspend a hidden tab's JS/audio at all — registering it may reduce how often the "OS kills it" path even gets hit, though this phase doesn't rely on that as its correctness mechanism (the reconciliation checkpoint has to be correct regardless).
