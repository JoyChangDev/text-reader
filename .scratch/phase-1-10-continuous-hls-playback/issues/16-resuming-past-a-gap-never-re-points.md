# 16 — Resuming past a gap never re-points, so the Book opens out of sync

**What to build:** Derive the playlist's start Chunk from the resume position on mount, the same
way a seek derives it. `playlistStart` is `useState(0)` and is only ever changed by
`seekToSentence`, so a Book reopened at a position beyond an ungenerated stretch plays from Chunk 0
while highlighting a Sentence hundreds of Chunks away.

**Blocked by:** —

**Status:** ready-for-agent — reproduced on an iPhone on 2026-08-16, and the mechanism is fully
traced below. Unlike [ticket 15](15-the-re-point-races-the-generation-it-asked-for.md) this one has
no open design question: the mount already knows where reading is, and the rule it needs is the one
`seekToSentence` already applies.

Found verifying [ticket 07](07-seeking-past-the-generated-region.md) on the device. It is the
reason that ticket cannot be verified on its own: whatever a long seek does, the next launch
re-enters the Book through this path.

## What happens

[`playlistStart`](../../../app/_lib/useBookPlayer.js#L84) is `useState(0)`, and the only
`setPlaylistStart` in the file is [line 581](../../../app/_lib/useBookPlayer.js#L581), inside
`seekToSentence`'s re-point branch. Nothing derives it from where reading actually is.

So a Book reopened at a resume position past a gap:

1. `playlistStart` is 0, so the playlist is built from Chunk 0 and truncates at the first gap.
2. `pendingSeekRef` is initialised to the resume ordinal
   ([line 185](../../../app/_lib/useBookPlayer.js#L185)) — "a saved resume position starts life as
   one of these".
3. That Sentence's Chunk is past the truncation, so its cue never arrives and the parked seek is
   never applied. There is no timeout and nothing re-points.
4. `handleCueChange` returns early for as long as a seek is parked
   ([line 224](../../../app/_lib/useBookPlayer.js#L224)) — correctly, since cues crossed on the way
   to a target are not where reading is. **So the highlight freezes at the resume position.**
5. The element, having never been seeked, plays the playlist from its zero — Chunk 0.

The result is a Book that opens with the highlight in the right place and the audio at the
beginning, with no error and nothing on screen suggesting anything is wrong.

**What the Listener discovered by accident:** tapping the highlighted Sentence fixes it. That runs
`seekToSentence` on a target the playlist cannot reach, which re-points — doing by hand the thing
the mount should have done.

## Acceptance criteria

- [ ] On mount, the playlist's start Chunk is derived from the resume position rather than being
      fixed at 0, so a Book reopened past a gap plays from where reading is.
- [ ] A Book whose resume position is reachable from Chunk 0 — the ordinary case, no gap in between
      — still starts its playlist at 0 and still parks the resume seek exactly as it does today.
      This must not become a reload for every Book that has ever been opened.
- [ ] A Book with no resume position still starts at Chunk 0.
- [ ] The highlight and the audio agree from the first moment playback starts, with no tap needed.
- [ ] A resume position pointing past the end of the Book, or at a Chunk that no longer exists,
      falls back rather than producing a playlist with no segments — see
      [ticket 15](15-the-re-point-races-the-generation-it-asked-for.md), whose failure this would
      otherwise reproduce on launch.
- [ ] Tests: mounting with a resume position past a gap starts the playlist at that Chunk;
      mounting with a reachable resume position does not change `playlistStart`; mounting with no
      resume position starts at 0.
- [ ] Verified on a physical iPhone: reopen a Book left at a position past an ungenerated stretch,
      and the first thing heard matches the highlighted Sentence.

## Comments

### Why `canPlaylistReach` is already the rule this needs

`seekToSentence` decides between parking and re-pointing with
[`canPlaylistReach`](../../../app/_lib/useBookPlayer.js#L533) — true only when every Chunk from the
playlist's start to the target is narrated. That is exactly the question the mount needs to ask
about the resume position, and asking it is what keeps the second criterion above true: an ordinary
resume, with no gap in between, answers "reachable" and nothing changes.

The awkward part is timing rather than logic. `canPlaylistReach` reads `generatedChunksRef`, which
is populated by the manifest fetch — so on the very first render nothing is known yet and the
honest answer is "not yet". The initial `playlistStart` therefore cannot simply be computed in a
`useState` initialiser from data that has not arrived.

### The interaction with ticket 15 is the thing to get right

This ticket makes the app request `?from=<resume chunk>` on launch. If that Chunk is not generated
— which is possible, since a resume position can outlive the audio it was recorded against once
[the retention rule](../../phase-1-11-object-storage-migration/issues/04-segment-origin-becomes-configuration.md)
deletes old segments — the result is the empty playlist ticket 15 is about, on every launch, before
the Listener has touched anything.

So the fifth criterion above is not defensive padding: without it this fix converts a silent
mismatch into a Book that will not open at all. Landing 15 first, or landing both together, is the
safer order.

### Not a regression from ticket 07

Worth being precise, since both tickets were found by verifying 07. Ticket 07 introduced
`playlistStart` and set it in the one place it needed to. The mount path was already fixed at
Chunk 0 before 07, and before 07 that was harmless — a playlist always started at 0, so "reachable
from the start" and "reachable at all" were the same question. Ticket 07 made them different
questions and updated one of the two callers.
