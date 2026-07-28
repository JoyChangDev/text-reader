# 04 — Playback speed control

**What to build:** The Listener can choose a playback speed from fixed presets. Changes
apply immediately to whatever is currently playing, and persist as a device-wide default
across books.

**Blocked by:** 02 (extends the same Listener settings store)

**Status:** ready-for-agent

- [ ] `listenerSettings` (02) is extended with a `speed` field, defaulting to `1x`
- [ ] Discrete presets are offered: 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x
- [ ] Selecting a speed sets `audioRef.current.playbackRate` immediately on the currently
      loaded audio, and is applied to every subsequently loaded chunk within
      `useBookPlayer`
- [ ] No new TTS calls, storage, or cache key changes — this is a pure client-side effect
- [ ] A minimal control (e.g. a button/select cycling the presets) is added to the
      current `AudioPlayer.jsx`, not the redesigned player bar
- [ ] Unit/integration tests verify `playbackRate` is applied on selection and persists
      across a chunk change within `useBookPlayer`

## Comments
