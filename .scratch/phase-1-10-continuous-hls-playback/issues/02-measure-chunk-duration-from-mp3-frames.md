# 02 — Measure Chunk duration from MP3 frames

**What to build:** A pure module (e.g. `app/_lib/mp3Frames.js`) that walks an MP3's frame headers to return its exact duration, wired into the generation path so every Chunk's stored metadata gains a `durationSeconds`.

**Blocked by:** 01 — resolved

**Status:** ready-for-agent

_Scope reduced by ticket 01._ This ticket originally also built an ID3v2 PRIV timestamp tag for packed-audio segments. Ticket 01 established that raw edge-tts MP3s play as HLS segments untagged, so the tag is not built — it was verified harmless, but harmless is not a reason to build something. Nothing about how audio is generated or stored changes here; only the metadata gains a field.

`#EXTINF` values and Sentence cue times have to agree with the audio across a whole Book. The last word boundary's `offset + duration` excludes trailing silence, and edge-tts isn't guaranteed to emit constant bitrate, so neither the boundary data nor size ÷ bitrate is usable. Ticket 01 also showed Safari builds its timeline from the decoded audio rather than from `#EXTINF`, so the measurement has to agree with what the decoder counts — which frame-walking does by construction, since both count the same frames.

- [ ] `mp3Frames.js` takes bytes and returns the duration in seconds, computing each frame's duration from its sampling rate and samples-per-frame. No new dependencies.
- [ ] It skips a leading ID3v2 tag if one is present, rather than treating it as frame data.
- [ ] A truncated or trailing-garbage file returns what it could measure rather than throwing — a Chunk with a slightly short measurement is recoverable, an exception during generation is not.
- [ ] Unit tests cover: a fixture of known duration, a fixture with a leading ID3v2 tag, a truncated fixture, and a file with no valid frames at all (returns zero rather than throwing).
- [ ] `getOrGenerateAudio` in [audioGenerationService.js](app/_lib/audioGenerationService.js) measures duration at generation time and passes it through to storage; the persisted metadata object gains `durationSeconds` alongside its existing `url` and `boundaries`.
- [ ] `blobStorageClient.put` persists that field without any other change to its shape — `<key>.json` gains a key, it does not become a different document.
- [ ] Chunks already cached from before this ticket (metadata with no `durationSeconds`) are handled explicitly: decide and implement either lazy re-measurement on read or treating them as a cache miss, and state which in a comment. Do not let `undefined` reach playlist generation.
- [ ] No ID3 tagging is added, and the stored MP3 bytes are exactly what edge-tts returned — ticket 01 removed the reason for it.
- [ ] Existing `audioGenerationService.test.js` and `blobStorageClient.test.js` coverage passes unchanged.

## Comments
