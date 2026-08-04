# 04 — Single-element HLS playback, and deleting the chunk queue

**What to build:** Rewrite `useBookPlayer` around one `<audio>` element whose `src` is the EVENT playlist from ticket 03, with `.play()` called exactly once per listening session — from the Listener's gesture, never at a boundary. Delete the ping-pong pair and everything built to police it.

**Blocked by:** 03

**Status:** ready-for-agent

Per [ADR 0003](../../../docs/adr/0003-hls-continuous-playback.md), the failure condition is a background `.play()` on a freshly-loaded element, not a frozen main thread. This ticket removes the only thing that ever needed a second `.play()`. Sentence highlighting is deliberately **not** in this ticket — it moves to cues in ticket 05, so this one can be verified on its own terms (audio plays continuously; nothing advances anything).

Highlighting will be temporarily degraded between this ticket and the next. That is accepted rather than worked around: keeping the span lookup alive across both would mean threading cumulative offsets through code ticket 05 deletes.

- [ ] `useBookPlayer` exposes one `audioRef` instead of `primaryAudioRef`/`secondaryAudioRef`, and `AudioPlayer.jsx` renders one `<audio>` — **without** `crossorigin`, which would create a CORS requirement the design doesn't otherwise have (no `<track src>`, nothing reads the audio data).
- [ ] Cross-origin segment fetching is confirmed here, since this is the first time real Vercel Blob URLs are played (folded in from ticket 01, which dropped its own A′ case). If segments fail to load, the fix is a CORS header on blob responses — the segment format itself is already settled.
- [ ] `src` is the ticket 03 playlist URL for the current (Book, voice). It is set on mount and re-pointed only when `voice` changes — no other code path assigns `src`.
- [ ] `play()` is called only from the Listener's gesture (the transport control, or a MediaSession `play` action). No effect, timer, or event handler calls it.
- [ ] `speed` continues to drive `playbackRate` on the single element.
- [ ] Deleted: `activeIsPrimary`, `standbyAudioRef`/`standbyLoadedIndexRef`, `enforceSingleActiveAudio`, the chunk-advance path in `handleEnded`, and the ping-pong preload effect.
- [ ] Deleted: the Phase 1.9 stall retry and its supports — `STALL_GRACE_MS`, `activePlayAttemptAtRef`, and the `currentTime === 0` check at [useBookPlayer.js:455](app/_lib/useBookPlayer.js#L455).
- [ ] Deleted: the dead `currentTimeSeconds` state at [useBookPlayer.js:64](app/_lib/useBookPlayer.js#L64) (written in three places, never read).
- [ ] Deleted: the `logDiagnosticEvent` calls inside `useBookPlayer` that instrumented the removed code. `BackgroundDiagnosticsPanel.jsx` itself stays — removing it is out of scope for this phase.
- [ ] The foreground-resync reconciliation is reduced to what still has a job: correcting `isPlaying` against the element's real `paused` state. Its `activeSentenceIndex` recomputation and chunk-advance branch go, since neither has anything left to correct.
- [ ] `chunkFetchPlan` still drives look-ahead generation, with the window raised from `LOOKAHEAD = 2` so the generated region stays ahead of playback (see the EVENT-playlist risk in the spec's Further Notes). Record the chosen value and the reasoning in a comment.
- [ ] Resume-position persistence keeps its current `(resumeIndex, resumeSentenceIndex)` shape and its debounce/flush behaviour. `bookProgress.js` and `libraryService.js` are untouched.
- [ ] `AudioPlayer.test.jsx`'s fake-`<audio>` harness is reduced to one element, and a test asserts `play()` is called exactly once across a simulated Book that crosses several Chunk boundaries.
- [ ] Deleted with their subjects: ping-pong preload/swap tests, single-active-audio invariant tests, and stall-retry tests.
- [ ] Surviving coverage passes: look-ahead fetch planning, play/pause, resume persistence and its background flush.

## Comments
