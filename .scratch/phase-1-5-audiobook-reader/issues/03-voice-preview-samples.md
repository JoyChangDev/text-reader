# 03 — Voice preview samples

**What to build:** Before committing to a voice, the Listener can play a short static
sample clip of each option directly from the voice picker.

**Blocked by:** 02 (needs the voice picker to exist)

**Status:** ready-for-agent

- [ ] A one-time script generates 3 short sample clips (the same fixed sentence, one per
      voice) via `edge-tts-universal`, committed as static assets — not generated at
      runtime
- [ ] No new API route or cache key is introduced for previews; clips are served as
      static files
- [ ] The voice picker (02) plays the corresponding sample clip when previewed, without
      changing the persisted selection until the Listener actually picks that voice
- [ ] Previewing a voice triggers no `edge-tts` call and no request to
      `/api/audio-chunks`

## Comments
