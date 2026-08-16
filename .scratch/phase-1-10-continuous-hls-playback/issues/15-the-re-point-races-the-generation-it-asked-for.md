# 15 — The re-point races the generation it asked for

**What to build:** Stop pointing the media element at a playlist that has no segments. A seek past
the generated region sets `playlistStart` to the target Chunk immediately and only then starts
generating it, so the element is handed an empty playlist, errors, and never recovers.

**Blocked by:** — (but see "The open question" below: the fix needs a decision before it is written)

**Status:** needs-triage — reproduced on an iPhone and confirmed against the running route on
2026-08-16. The mechanism is not in doubt; what the Listener should see during the wait is, and
that decision shapes the fix.

Found verifying [ticket 07](07-seeking-past-the-generated-region.md) on the device, which is what
that ticket's last open criterion was for. **Ticket 07 does not pass**: its fix is correct when the
target Chunk is already generated, and a long seek is by definition a seek to one that is not.

## What happens

[`useBookPlayer.js:580`](../../../app/_lib/useBookPlayer.js#L580), in `seekToSentence`'s re-point
branch:

```js
pendingSeekRef.current = ordinal;
setPlaylistStart(chunkIndex); // src becomes ?from=N right now

if (chunkAudio[chunkIndex]?.status !== 'ready') {
  fetchChunk(chunkIndex); // ...and generation only starts here
}
```

`src` is re-pointed at `?from=N` while Chunk N does not exist yet.
[`buildEventPlaylist`](../../../app/_lib/hlsPlaylist.js#L30) slices from `N`, finds the first gap
at offset 0 — Chunk N itself — and emits a playlist with no segments and no `#EXT-X-ENDLIST`.

Measured against the running route, on the Book this was reproduced with (2,372 Chunks, 0–16
generated and contiguous):

| request     | status | segments |
| ----------- | ------ | -------- |
| `?from=0`   | 200    | 17       |
| `?from=17`  | 200    | **0**    |
| `?from=500` | 200    | **0**    |

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:1
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-MEDIA-SEQUENCE:0
```

On the device this surfaced as **"播放時發生錯誤，請重新整理後再試。"** — the non-`SRC_NOT_SUPPORTED`
branch of `PlayerBar`'s media error, on iPhone Safari, which has native HLS and should never refuse
a well-formed playlist.

**And nothing recovers it.** `src` derives from `{ bookId, voice, playlistStart, speed }`. Chunk N
finishing generation changes `readyChunkCount`, which re-fetches the manifest and adds cues, but
never reassigns `src`. The element stays errored on the empty playlist until the page is reloaded —
which is exactly what the Listener had to do.

**Corroborating evidence that the jump never completed:** that Book's generated Chunks are 0–16,
contiguous. The far Chunk the Listener jumped to was never produced at all. `fetchChunk(N)` was
fired, but its result had nowhere to go.

## Acceptance criteria

- [ ] A seek past the generated region never points the element at a playlist with no segments.
- [ ] When the target Chunk finishes generating, playback begins there **without the Listener
      doing anything** — no reload, no second tap.
- [ ] If the target Chunk **fails** to generate, the Listener is told, and is left somewhere they
      can act from rather than on a dead element. The existing 此段落的語音產生失敗。 may be the
      right message; what must not happen is the current silence-then-error.
- [ ] The element is never left in an unrecoverable error state by a state change the app itself
      made. Whatever the mechanism, a Chunk becoming ready must be able to get playback moving
      again.
- [ ] The wait is visible. A long seek costs a real synthesis round-trip, and the Listener has
      just made an explicit gesture — the current behaviour (highlight moves, audio keeps playing
      the old stretch, then an error) is the failure this phase exists to remove, in miniature.
- [ ] Seeks that do **not** re-point are untouched: an already-cued target still writes
      `currentTime` with no reload, and a target the playlist can still grow to reach still parks
      via `pendingSeekRef`. Both are ticket 07's, and both work.
- [ ] Tests cover the race directly — a seek to an ungenerated Chunk, asserting the element is not
      pointed at a segment-less playlist, and that playback starts once generation resolves.
- [ ] Verified on a physical iPhone: jump past an ungenerated stretch, and playback resumes there
      on its own.

## Comments

### The open question, which is why this is needs-triage rather than ready-for-agent

The obvious fix — wait for `fetchChunk(N)` to resolve, then set `playlistStart` — is probably right,
but it makes a decision this ticket should not make silently: **what does the Listener see and hear
during the wait?**

Three things are true at once and they pull apart:

- The synthesis is a real round-trip, plausibly several seconds. It cannot be hidden.
- The highlight already moves to the target immediately, before the branch
  ([`seekToSentence`](../../../app/_lib/useBookPlayer.js#L573), "the highlight moves whether or not
  the audio can"). So during the wait the highlight is in the new place and the audio is still in
  the old one — a mismatch that exists today and that a wait makes longer and more noticeable.
- Whether the old stretch should keep playing, or pause, is a taste question about what a long jump
  means. Keeping it playing means the Listener hears words they did not ask for; pausing means
  silence with a spinner.

None of these is answerable from the code, which is why the fix is not written yet.

### Why this cannot be fixed by making the route stricter

Refusing to serve an empty playlist — a 409, say — would replace one media error with another. The
element is being handed a source it cannot use either way, and the client is the only place that
knows the Chunk is _about to_ exist. The route is right to describe the Book truthfully; the client
is wrong to ask about a stretch it has not made yet.

The empty playlist itself is deliberate and predates this: the comment on
[`targetDuration`](../../../app/_lib/hlsPlaylist.js#L34) names "the path a Book takes before its
first Chunk exists" and floors the reload interval for exactly that reason. At Book start nothing
is trying to play. Here something is.

### Related

[Ticket 16](16-resuming-past-a-gap-never-re-points.md) is the other half of the same root: a
`playlistStart` that is only ever set in one place, and at the wrong moment. Neither ticket fixes
the other, and 16 will keep producing a Book that opens with the audio and the highlight in
different places even once this one lands.
