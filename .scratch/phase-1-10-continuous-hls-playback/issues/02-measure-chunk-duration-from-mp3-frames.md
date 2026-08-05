# 02 — Measure Chunk duration from MP3 frames

**What to build:** A pure module (e.g. `app/_lib/mp3Frames.js`) that walks an MP3's frame headers to return its exact duration, wired into the generation path so every Chunk's stored metadata gains a `durationSeconds`.

**Blocked by:** 01 — resolved

**Status:** ready-for-human

_Scope reduced by ticket 01._ This ticket originally also built an ID3v2 PRIV timestamp tag for packed-audio segments. Ticket 01 established that raw edge-tts MP3s play as HLS segments untagged, so the tag is not built — it was verified harmless, but harmless is not a reason to build something. Nothing about how audio is generated or stored changes here; only the metadata gains a field.

`#EXTINF` values and Sentence cue times have to agree with the audio across a whole Book. The last word boundary's `offset + duration` excludes trailing silence, and edge-tts isn't guaranteed to emit constant bitrate, so neither the boundary data nor size ÷ bitrate is usable. Ticket 01 also showed Safari builds its timeline from the decoded audio rather than from `#EXTINF`, so the measurement has to agree with what the decoder counts — which frame-walking does by construction, since both count the same frames.

- [x] `mp3Frames.js` takes bytes and returns the duration in seconds, computing each frame's duration from its sampling rate and samples-per-frame. No new dependencies.
- [x] It skips a leading ID3v2 tag if one is present, rather than treating it as frame data.
- [x] A truncated or trailing-garbage file returns what it could measure rather than throwing — a Chunk with a slightly short measurement is recoverable, an exception during generation is not.
- [x] Unit tests cover: a fixture of known duration, a fixture with a leading ID3v2 tag, a truncated fixture, and a file with no valid frames at all (returns zero rather than throwing).
- [x] `getOrGenerateAudio` in [audioGenerationService.js](app/_lib/audioGenerationService.js) measures duration at generation time and passes it through to storage; the persisted metadata object gains `durationSeconds` alongside its existing `url` and `boundaries`.
- [x] `blobStorageClient.put` persists that field without any other change to its shape — `<key>.json` gains a key, it does not become a different document.
- [x] Chunks already cached from before this ticket (metadata with no `durationSeconds`) are handled explicitly: decide and implement either lazy re-measurement on read or treating them as a cache miss, and state which in a comment. Do not let `undefined` reach playlist generation.
- [x] No ID3 tagging is added, and the stored MP3 bytes are exactly what edge-tts returned — ticket 01 removed the reason for it.
- [x] Existing `audioGenerationService.test.js` and `blobStorageClient.test.js` coverage passes unchanged. _Read as "nothing was loosened" — see `## Comments`; every existing case still asserts what it did, and the edits only add `durationSeconds` to expected objects._

## Comments

### Measurement validated against ffprobe on real edge-tts output

`measureMp3Duration` was run over the 12 MP3s ticket 01's probe generated
(`public/hls-packed-audio/{raw,tagged}/seg-*.mp3`, real `edge-tts-universal` output) and
compared with `ffprobe -show_entries format=duration`. All 12 agree to within floating-point
noise (max diff < 1e-4 s), including the six with a leading ID3v2.4 tag, and the six raw
segments sum to 72.504s — the 72.5s the iPhone run measured. The bytes are MPEG2 Layer III,
48kbps, 24000Hz, no Xing/LAME header, so every frame in the file is audio and the frame sum
_is_ the decoder's count, as the ticket assumed.

That profile's 576 samples per frame (not MPEG1's 1152) is also what makes the frame-length
formula `samplesPerFrame / 8 * bitrate / sampleRate` rather than the commonly copied constant
144 — `mp3Frames.test.js` carries a fixture for it so the shortcut can't creep back in.

### Legacy cache: lazy re-measurement, with regeneration as the fallback

Metadata with no `durationSeconds` is repaired in place — the stored MP3 is read back and
measured, and the metadata blob rewritten. Resynthesizing would cost an edge-tts round trip
and edge-tts isn't guaranteed to return identical bytes, which would desync the audio already
referenced by `url`.

The one case that needed a decision: what to do when re-measurement yields nothing (audio blob
missing, or unmeasurable). Persisting the `0` would be permanent and would surface later as
`#EXTINF:0` with no trace of where it came from, so nothing is written and the Chunk is
regenerated instead — that entry can't back a playlist entry either way. The cache-hit guard
is `durationSeconds > 0` rather than `!== undefined` so a zero from any source takes the same
path rather than reaching playlist generation.

### What "existing coverage passes unchanged" turned out to mean

Existing assertions were edited, not merely added to: the cache-hit and cache-miss cases in
`audioGenerationService.test.js` now expect `durationSeconds` in the objects they already
asserted on. Nothing was loosened — every case still asserts what it did before, and the
cache-hit case gained one (`getAudioBytes` is not called). `blobStorageClient.test.js` only
gained new `describe` blocks; its existing cases are untouched.

### `progressiveGeneration.test.js` fake had to become faithful

Its fake edge-tts returned `new Blob(['audio-for:...'])`, which measures as 0 seconds and so
made every cached chunk look unusable under the rule above — the test caught it. The fake now
returns real MPEG2 Layer III frames, and its fake blob store keeps audio as bytes instead of
text (UTF-8 decoding an MP3 doesn't round-trip). A new case there covers the legacy-repair path
end-to-end: seeded pre-ticket-02 metadata is repaired from stored audio with no synthesis call.
