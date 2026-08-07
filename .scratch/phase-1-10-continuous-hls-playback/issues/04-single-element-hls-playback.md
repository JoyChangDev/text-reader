# 04 — Single-element HLS playback, and deleting the chunk queue

**What to build:** Rewrite `useBookPlayer` around one `<audio>` element whose `src` is the EVENT playlist from ticket 03, with `.play()` called exactly once per listening session — from the Listener's gesture, never at a boundary. Delete the ping-pong pair and everything built to police it.

**Blocked by:** 03

**Status:** ready-for-agent

Per [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md), the failure condition is a background `.play()` on a freshly-loaded element, not a frozen main thread. This ticket removes the only thing that ever needed a second `.play()`. Sentence highlighting is deliberately **not** in this ticket — it moves to cues in ticket 05, so this one can be verified on its own terms (audio plays continuously; nothing advances anything).

Highlighting will be temporarily degraded between this ticket and the next. That is accepted rather than worked around: keeping the span lookup alive across both would mean threading cumulative offsets through code ticket 05 deletes.

- [x] `useBookPlayer` exposes one `audioRef` instead of `primaryAudioRef`/`secondaryAudioRef`, and `AudioPlayer.jsx` renders one `<audio>` — **without** `crossorigin`, which would create a CORS requirement the design doesn't otherwise have (no `<track src>`, nothing reads the audio data).
- [ ] **Partial.** Cross-origin segment fetching is confirmed here, since this is the first time real Vercel Blob URLs are played (folded in from ticket 01, which dropped its own A′ case). If segments fail to load, the fix is a CORS header on blob responses — the segment format itself is already settled. _Segments do fetch: a real `.mp3` from the live store returns 200 with real MP3 bytes, no CORS header needed, exactly as this ticket predicted. But the fetch is only reliable while the store isn't rate-limiting us, and [ticket 08](08-playlist-routes-read-one-blob-per-chunk.md) is why it often is. Re-check on a device once that lands._
- [x] `src` is the ticket 03 playlist URL for the current (Book, voice). It is set on mount and re-pointed only when `voice` changes — no other code path assigns `src`.
- [x] `play()` is called only from the Listener's gesture (the transport control, or a MediaSession `play` action). No effect, timer, or event handler calls it.
- [x] `speed` continues to drive `playbackRate` on the single element.
- [x] Deleted: `activeIsPrimary`, `standbyAudioRef`/`standbyLoadedIndexRef`, `enforceSingleActiveAudio`, the chunk-advance path in `handleEnded`, and the ping-pong preload effect.
- [x] Deleted: the Phase 1.9 stall retry and its supports — `STALL_GRACE_MS`, `activePlayAttemptAtRef`, and the `currentTime === 0` check at [useBookPlayer.js:455](app/_lib/useBookPlayer.js#L455).
- [x] Deleted: the dead `currentTimeSeconds` state at [useBookPlayer.js:64](app/_lib/useBookPlayer.js#L64) (written in three places, never read).
- [x] Deleted: the `logDiagnosticEvent` calls inside `useBookPlayer` that instrumented the removed code. `BackgroundDiagnosticsPanel.jsx` itself stays — removing it is out of scope for this phase.
- [x] The foreground-resync reconciliation is reduced to what still has a job: correcting `isPlaying` against the element's real `paused` state. Its `activeSentenceIndex` recomputation and chunk-advance branch go, since neither has anything left to correct.
- [x] `chunkFetchPlan` still drives look-ahead generation, with the window raised from `LOOKAHEAD = 2` so the generated region stays ahead of playback (see the EVENT-playlist risk in the spec's Further Notes). Record the chosen value and the reasoning in a comment.
- [x] Resume-position persistence keeps its current `(resumeIndex, resumeSentenceIndex)` shape and its debounce/flush behaviour. `bookProgress.js` and `libraryService.js` are untouched.
- [x] `AudioPlayer.test.jsx`'s fake-`<audio>` harness is reduced to one element, and a test asserts `play()` is called exactly once across a simulated Book that crosses several Chunk boundaries.
- [x] Deleted with their subjects: ping-pong preload/swap tests, single-active-audio invariant tests, and stall-retry tests.
- [x] Surviving coverage passes: look-ahead fetch planning, play/pause, resume persistence and its background flush.

## Comments

### Implementation notes

**`LOOKAHEAD = 10`** — roughly two minutes of audio ahead of the anchor at the ~12s Chunks ticket 01 measured. Not wider because the whole plan is requested in parallel, so the window is also the size of the TTS burst a Book fires on open.

**This ticket cannot make the generated region "stay ahead of playback" on its own**, and raising the window doesn't change that. The anchor is `currentIndex`, and nothing advances it during playback any more — segment advancement left the app, so nothing tells it a Chunk ended. A listening session therefore generates this window and stops, and a Book longer than ~11 Chunks stops playing at the end of the generated region. Ticket 05's `cuechange` handler is what restores an advancing anchor; **ticket 06 must re-check this value once it does**, since its test needs playback to catch up to a genuinely growing playlist.

**What else is knowingly degraded between this ticket and ticket 05:**

- **Sentence-click seeking no longer moves the audio.** A Sentence's stored offset is relative to its own Chunk; writing that onto a timeline that now runs across the whole Book would seek to the wrong place — actively wrong rather than merely stale. So `applySeek`, `pendingSeekRef`, and `seekAppliedIndexRef` went with the chunk-advance machinery, and `seekToSentence` keeps the halves that still mean something: it moves the highlight, persists the position, and requests generation for the target Chunk. Ticket 05 restores the audio half from cue times, the only correct source for it.
- **Opening a Book part-way through starts its audio from the beginning.** Same cause — the saved `(resumeIndex, resumeSentenceIndex)` has no absolute time until cues arrive. The saved Sentence is still highlighted, and the saved position is still persisted and still survives across sessions.

**Ticket 05's deletion of the time-to-Sentence mapping was taken early**, because leaving it in place is not "degraded highlighting" but a corrupted saved place. `findActiveSentenceIndex` maps a Book-wide `currentTime` against Chunk-relative spans: at `currentTime` 0 it names Sentence 0, so the first `timeupdate` after opening a Book part-way through overwrites the Listener's saved Sentence, and past the anchor Chunk's last span it clamps there and persists that for the rest of the Book. Deleted here, one ticket early: `findActiveSentenceIndex`, `handleTimeUpdate` and its `onTimeUpdate` wiring, the `currentSentenceSpans` memo, and `useBookPlayer`'s import of `deriveSentenceSpans` — which is also what ADR 0003 says this phase removes. Between the two tickets, the highlight and the saved position move only when the Listener moves them, and a test asserts an advancing clock changes neither.

The debounced persistence path keeps its shape, its flush-on-hidden and `pagehide` behaviour, and its tests, now driven by the write every Book schedules when it opens rather than by a Sentence advance. Its coalescing case was replaced: coalescing rapid _automatic_ advances has no trigger until ticket 05, so the test now covers the other half of the same contract — an explicit Sentence click bypassing the debounce.

Three tests were deleted whose subject was the chunk-advance path rather than the ping-pong pair: advancing into a look-ahead Chunk that had already failed, reconciliation advancing a Chunk that ended while hidden, and reconciliation recomputing the highlight from `currentTime`. All three described a Chunk boundary the app is no longer told about. A new test asserts the invariant that replaced them — nothing calls `play()` on the way back to the foreground — and `play()` is verified to be called exactly once across a Book that crosses several Chunk boundaries.

**Not verified in a browser here.** The single-element player can't be exercised locally: `/dev-preview` stopped being able to reach the reader after the phase-1.9 route split (its fetch mock isn't armed on `/book/[bookId]`, and `mockedFetch` throws on the RSC payload request), and the real route needs blob credentials. Coverage is the 39 `AudioPlayer.test.jsx` cases against the real component tree. The remaining checkbox above — cross-origin segment fetching from real Vercel Blob URLs — needs a deploy and a physical device, like ticket 01's.
