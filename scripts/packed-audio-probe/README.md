# Packed-audio probe

Regenerable probe for the question ticket 01 of phase 1.10 settled: **can raw edge-tts
MP3s be used as HLS segments?** The answer was yes. This is kept as the regression test
for that answer, not as a record of it — the record is in
[ticket 01's Comments](../../.scratch/phase-1-10-continuous-hls-playback/issues/01-verify-mp3-packed-audio-segments.md).

## Why this is still here

HLS **requires** packed-audio segments to carry their first sample's timestamp in an ID3
PRIV frame owned by `com.apple.streaming.transportStreamTimestamp`, and edge-tts output
carries no such tag. Ticket 01 found that Safari plays untagged MP3s anyway, which is what
lets the whole phase reuse the Chunk MP3s already in blob storage without transcoding.

That conclusion rests on **undocumented leniency, not on the specification** — the spec is
against us here. A future iOS could start enforcing the tag, and the symptom would be
playback that stops at the first segment boundary, which is indistinguishable from the
original bug this phase set out to fix. If that happens, run this probe: case A failing
while case B passes identifies the cause in one listen, and `buildTimestampTag` in
`generate.mjs` is the verified fix, ready to move into the generation path.

## Running it

```bash
node scripts/packed-audio-probe/generate.mjs
```

Writes six real Chunks (~72.5s), three playlists, and the test page into
`public/hls-packed-audio/`, which is **gitignored** — the audio is ~900KB and has no
business in this repository's history. Needs `ffmpeg`/`ffprobe` on `PATH`, and no
`BLOB_READ_WRITE_TOKEN`: generation and storage are separate concerns and this skips
storage entirely.

To test on a phone, commit the output on a throwaway branch and use the Vercel preview URL:

```bash
git switch -c spike/packed-audio-recheck && git add -f public/hls-packed-audio
```

Open `/hls-packed-audio/index.html` — the path must include `index.html`, because Next
does not resolve the directory index and will 308 to a 404. Delete the branch afterwards
rather than merging it.

## The cases

| Case | Segments                    | Isolates                                              |
| ---- | --------------------------- | ----------------------------------------------------- |
| A    | raw MP3                     | is the MP3 packed-audio format accepted at all?       |
| B    | ID3-tagged MP3              | does the required PRIV timestamp make the difference? |
| C    | tagged, one `#EXTINF` +0.5s | how much duration error is survivable?                |

All three are same-origin, deliberately. A fourth case serving the same MP3s from Vercel
Blob was dropped: it existed to tell a CORS failure apart from a format failure, and once
case A passed there was no failure left to attribute. The real player never sets
`crossorigin` — cues come from `addTextTrack`/`addCue`, not a `<track src>` — so it never
asks for CORS in the first place.

## If you change the passages

`index.html` carries a hardcoded `DURATIONS` array so it can show which segment is playing
and whether playback reached the end. The script prints the measured durations when it
finishes and tells you if they need updating there.

## What ticket 01 measured

| Case | Result                                |
| ---- | ------------------------------------- |
| A    | played all 6 segments, 72.5s / 72.5s  |
| B    | played all 6 segments, 72.7s / 72.5s  |
| C    | played all 6 segments, ended at 72.5s |

Case C is worth restating: the playlist declared 73.0s while the audio was 72.5s, and
playback ended at 72.5s — so Safari builds its timeline from the decoded audio rather than
by accumulating `#EXTINF`. Duration error does not accumulate into cue drift, but the
duration measurement has to agree with what the decoder counts.
