# 02 — Voice selection (core)

**What to build:** The Listener can choose a narration voice from the available zh-TW
options. The choice persists across sessions and books on this device, and applies to
chunk generation from the point of selection onward — already-generated audio is not
invalidated.

**Blocked by:** none

**Status:** ready-for-agent

- [x] A new Listener settings store (per ADR 0001, `listenerSettings.js`) persists a
      `voice` field in its own `localStorage` key, separate from `bookLibrary.js`'s
      per-book records
- [x] The picker offers all 3 available zh-TW voices: `zh-TW-HsiaoChenNeural` (current
      default), `zh-TW-YunJheNeural`, `zh-TW-HsiaoYuNeural`
- [x] Defaults to `zh-TW-HsiaoChenNeural` when no preference has been stored yet,
      matching today's hardcoded behavior
- [x] A minimal Select control is added to the current `AudioPlayer.jsx` — no redesign
      layout work here, that's a separate ticket
- [x] The selected voice is threaded from the UI through `POST /api/audio-chunks` →
      `generateAudioForChunk` → `getOrGenerateAudio`, replacing the hardcoded
      `DEFAULT_VOICE` passthrough in `audioGenerationService.js`
- [x] Changing the voice is prospective only: already-generated/cached chunks (keyed by
      the old voice, per the existing `${bookId}/${chunkIndex}/${voice}` cache key) are
      not invalidated or regenerated; only chunks generated after the change use the new
      voice
- [x] Unit tests cover the settings store (read/write/default) and the threading of
      `voice` through the API route and generation service with fake clients

## Comments
