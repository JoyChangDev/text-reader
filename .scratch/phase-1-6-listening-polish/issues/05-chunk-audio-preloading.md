# 05 — Chunk-to-chunk audio preloading

**What to build:** Eliminate the audible gap between chunks caused by the next chunk's
audio only starting to load once the current one ends, by buffering the next chunk's
actual audio ahead of time.

**Blocked by:** None — can start immediately

**Status:** done

- [x] `useBookPlayer.js` maintains two `<audio>` elements (active/standby) instead of one
- [x] As soon as the next chunk's audio is ready, its actual audio bytes begin loading into
      the standby element in the background while the current chunk is still playing
- [x] On chunk advance, playback switches to the already-buffered standby element rather
      than assigning a cold `src` and waiting on a fresh load
- [x] Existing chunk-advancement, look-ahead (`chunkFetchPlan`), retry, and error-state
      behavior is preserved unchanged
- [x] Tests simulate both audio elements' readiness/events and assert the swap happens
      without a fresh-load delay

## Comments

- Implementation: `useBookPlayer.js` now holds `primaryAudioRef`/`secondaryAudioRef` plus
  `activeIsPrimary` state - which physical element is "active" vs. "standby" is a role
  that ping-pongs via that one boolean flip, rather than copying values between refs.
  Per-physical-element `loadedIndexRef`s track what's actually loaded in each one; a new
  effect preloads the next chunk's audio into whichever is currently standby as soon as
  its metadata is `ready` (not gated on `isPlaying`, since preloading while paused is
  strictly better - nothing in the ticket requires gating it). `handleEnded` only flips
  `activeIsPrimary` when the standby element already holds the next chunk's audio;
  otherwise it's a no-op and the existing cold-load path in the "load and play" effect
  takes over unchanged, preserving the fallback/error/retry behavior.
- `AudioPlayer.jsx` renders both elements unconditionally with fixed testids
  (`audio-element`, `audio-element-standby`) and a `data-active` attribute reflecting
  `activeIsPrimary`, so tests can identify which one is current without depending on
  `.paused` (unreliable once `HTMLMediaElement.play`/`pause` are mocked in jsdom).
- Two existing tests asserted post-`ended` state on the _original_ `audio-element` testid,
  an assumption ping-ponging breaks once that element's role has swapped to standby;
  updated both to check the newly-active element instead (see "fetches a look-ahead
  buffer..." and "a selected speed carries over to the next chunk..." in
  `AudioPlayer.test.jsx`). A new `AudioPlayer chunk-to-chunk audio preloading` describe
  block covers preloading, swap-without-reload, and the not-yet-buffered fallback
  directly.
- Code review (Standards + Spec sub-agents, both run against this diff) surfaced one real
  gap and one design judgement call:
  - **Fixed:** neither `<audio>` element set `preload="auto"`. Assigning `.src` alone
    doesn't guarantee byte-level buffering in every browser (Firefox in particular
    defaults unset `preload` to metadata-only), which could have silently reintroduced
    the exact gap this ticket exists to close, undetectable by the jsdom-based tests
    (which only assert `.src`, not real network/buffering behavior). Added `preload="auto"`
    to both elements in `AudioPlayer.jsx`.
  - **Fixed:** the duplicated "assign `src`/`playbackRate`, stamp `loadedIndexRef`" shape
    (present in both the preload effect and the cold-load branch) was extracted into a
    shared `loadAudioInto()` helper in `useBookPlayer.js`.
  - **Not changed (judgement call):** the standards review also suggested collapsing the
    `primaryAudioRef`/`secondaryAudioRef` + `activeIsPrimary` ternary pattern into an
    array of two "slots" indexed by `activeIndex`/`1 - activeIndex`. Left as-is - a
    correctness-critical, already-passing piece of logic, and restructuring the underlying
    data model carries more regression risk than the readability gain justifies in this
    pass. Worth revisiting if a third audio-buffering concern is ever added.
  - **Not changed (accepted deviation):** the preload effect isn't gated on `isPlaying`,
    so it also buffers the next chunk while paused. The spec/ticket describe the ticket
    scenario as "while the current chunk is still playing," but nothing requires gating
    on it, and eagerly preloading during a pause is strictly better UX (no gap) than
    waiting for `play()` to resume before starting to buffer.
