# 02 — MediaSession play/pause integration

**What to build:** Register the MediaSession API (guarded by feature detection) so the OS treats playback as legitimate media — `play`/`pause` action handlers wired to the existing `play()`/`pause()` functions, `metadata` carrying the Book title, and `playbackState` kept in sync with `isPlaying`. Scoped to play/pause + metadata only — no `previoustrack`/`nexttrack`/`seekto`/`setPositionState`.

**Blocked by:** None — can start immediately (independent of ticket 01)

**Status:** ready-for-agent

- [ ] `navigator.mediaSession.setActionHandler('play', ...)` / `('pause', ...)` call through to the same `play`/`pause` functions the on-screen PlayerBar button uses, guarded by `'mediaSession' in navigator`.
- [ ] Handlers are re-registered if the underlying `play`/`pause` identities change, and cleared (`setActionHandler(action, null)`) on unmount.
- [ ] `navigator.mediaSession.metadata` is set to a `MediaMetadata` carrying the Book's `title` once available.
- [ ] `navigator.mediaSession.playbackState` is set to `'playing'`/`'paused'` in sync with `isPlaying`.
- [ ] No `previoustrack`/`nexttrack`/`seekto`/`setPositionState` handlers are registered.
- [ ] A test (guarding `navigator.mediaSession` presence, mocking it if not present in the JSDOM test environment) asserts invoking the registered `play`/`pause` handlers has the same effect as clicking the existing PlayerBar buttons, and that handlers are cleared on unmount.
- [ ] Environments without `navigator.mediaSession` (feature not supported) don't throw and the rest of playback is unaffected.

## Comments
