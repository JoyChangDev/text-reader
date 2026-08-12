# 02 — Playback lock + pending-start sentence selection

**What to build:** While a chunk is actively playing, the voice/speed controls and
sentence-click seeking are locked, so an accidental tap doesn't derail playback or change
settings mid-sentence. Pausing unlocks both. Selecting a sentence while paused sets where
the _next_ play will start rather than immediately playing.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Voice select and speed select are disabled while the current chunk is playing,
      enabled while paused
- [x] Clicking a sentence in the transcript while playing has no effect
- [x] Clicking a sentence while paused immediately updates the active-sentence highlight
      and displayed position (so the listener sees what's queued), without starting
      playback
- [x] Pressing play after selecting a sentence while paused begins playback from that
      selected sentence, once its chunk is ready
- [x] Scrolling the transcript is unaffected by playing/paused state either way
- [x] `seekToSentence` no longer forces playback to start (`wantsToPlay` is not set by it)
- [x] Existing AudioPlayer/PlayerBar/TranscriptView tests are updated to cover locked vs.
      unlocked behavior and the new pending-start flow

## Comments
