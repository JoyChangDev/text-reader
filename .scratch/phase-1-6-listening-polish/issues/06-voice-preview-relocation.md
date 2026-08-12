# 06 — Voice preview relocated to upload/library screen

**What to build:** Let the listener preview available voices before opening a book, not
only from inside the player.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Preview logic currently inline in `AudioPlayer.jsx` (preview audio element, toggle
      behavior, sample URL lookup) is extracted into a shared component/hook
- [x] Voice preview is available and functional from the upload/library screen, before any
      book is opened
- [x] Voice preview inside `PlayerBar` continues to work unchanged, now built on the shared
      implementation instead of a separate copy
- [x] Test coverage for the shared preview component/hook, exercised from both call sites

## Comments

- New `app/_components/VoicePreview.jsx`: a fully self-contained component (owns its own
  `previewingVoice` state and `previewAudioRef`) rather than a hook + separate render
  logic - since neither call site needs to read/drive the preview state from outside, a
  hook would've just added an extra layer with no one to share it with. Renders no
  wrapping layout (a bare list of buttons + a hidden `<audio>`), so each call site
  controls how it sits alongside its own other controls (inline in `PlayerBar`'s `HStack`;
  under its own "Preview voices" heading on the upload/library screen).
- `PlayerBar.jsx` now renders `<VoicePreview />` directly instead of receiving
  `previewingVoice`/`onTogglePreviewVoice` props and rendering the buttons itself.
  `AudioPlayer.jsx` no longer owns any preview state/ref/audio element at all - it was
  the only thing left importing `voiceSampleUrl` directly, so that import is gone too.
- `app/page.jsx` renders `<VoicePreview />` in the pre-book view, under a small "Preview
  voices" heading, between the uploader and the library list.
- Since each mounted `VoicePreview` owns independent state, previewing a voice on the
  library screen and then opening a book does _not_ carry the "currently previewing"
  state into the player (a fresh instance mounts) - this wasn't asked for either way, and
  matches the existing per-mount reset behavior the old inline version already had.
- Test coverage: `VoicePreview.test.jsx` is the thorough, single source of truth for the
  shared behavior (toggle/switch/reset-on-end), moved and adapted from what used to be
  `AudioPlayer.test.jsx`'s "AudioPlayer voice preview samples" describe block (now
  removed from that file). `PlayerBar.test.jsx` and `page.test.jsx` each carry one
  lighter smoke test proving the component is actually wired in at that call site,
  rather than re-testing the shared behavior twice more.
- Follow-up (2026-07-30): `PlayerSettingsSheet` (added after this ticket landed) now
  hosts its own `<VoicePreview />` alongside the voice picker, so the upload/library
  screen's standalone preview became a redundant second copy. Removed `<VoicePreview />`
  and its "Preview voices" heading from `app/page.jsx`, along with the matching smoke
  test in `page.test.jsx` - preview is now only reachable from inside the settings
  sheet. The second bullet above ("Voice preview is available ... from the upload/
  library screen") no longer reflects current behavior.
