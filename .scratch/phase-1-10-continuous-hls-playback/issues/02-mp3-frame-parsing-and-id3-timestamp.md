# 02 — Measure Chunk duration from MP3 frames, and tag segments

**What to build:** A pure module (e.g. `app/_lib/mp3Frames.js`) that walks an MP3's frame headers to return its exact duration and sample count, plus — if ticket 01 established it is needed — a builder for the ID3v2 PRIV timestamp tag that packed-audio segments require. Wire both into the generation path so every Chunk's metadata gains a `durationSeconds`, and (if required) every stored MP3 is tagged.

**Blocked by:** 01

**Status:** ready-for-agent

`#EXTINF` values and Sentence cue times have to agree with the audio across a whole Book, so an approximation won't do. The last word boundary's `offset + duration` excludes trailing silence, and edge-tts isn't guaranteed to emit constant bitrate, so neither the boundary data nor size ÷ bitrate is usable. Ticket 01's `#EXTINF` tolerance finding tells you how much error is actually survivable; frame-walking should beat it comfortably either way.

The same walk that sums durations also yields the sample count the ID3 timestamp needs, so both live in one module rather than two parsers over the same bytes.

- [ ] `mp3Frames.js` takes bytes and returns `{ durationSeconds, sampleCount }`, computing each frame's duration from its sampling rate and samples-per-frame. No new dependencies.
- [ ] It skips a leading ID3v2 tag if one is present, rather than treating it as frame data.
- [ ] A truncated or trailing-garbage file returns what it could measure rather than throwing — a Chunk with a slightly short measurement is recoverable, an exception during generation is not.
- [ ] Unit tests cover: a fixture of known duration, a fixture with a leading ID3v2 tag, a truncated fixture, and a file with no valid frames at all (returns zero rather than throwing).
- [ ] `getOrGenerateAudio` in [audioGenerationService.js](app/_lib/audioGenerationService.js) measures duration at generation time and passes it through to storage; the persisted metadata object gains `durationSeconds` alongside its existing `url` and `boundaries`.
- [ ] `blobStorageClient.put` persists that field without any other change to its shape — `<key>.json` gains a key, it does not become a different document.
- [ ] Chunks already cached from before this ticket (metadata with no `durationSeconds`) are handled explicitly: decide and implement either lazy re-measurement on read or treating them as a cache miss, and state which in a comment. Do not let `undefined` reach playlist generation.
- [ ] **Only if ticket 01 case B was required:** a pure builder emits an ID3v2 tag carrying a PRIV frame with owner identifier `com.apple.streaming.transportStreamTimestamp` and the 33-bit MPEG-2 timestamp of the segment's first sample, and it is prepended to the audio bytes before `put`. Unit tests assert the emitted bytes field by field, including the owner identifier and the timestamp encoding.
- [ ] **Only if ticket 01 case B was required:** the running timestamp is derived from the cumulative sample count of preceding Chunks, so a Chunk generated out of order still gets the right value.
- [ ] Existing `audioGenerationService.test.js` and `blobStorageClient.test.js` coverage passes unchanged.

## Comments
