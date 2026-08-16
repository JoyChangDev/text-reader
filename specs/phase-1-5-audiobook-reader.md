# Phase 1.5 — Audiobook Reader Enhancements

_Status: shipped, except upload formats — tickets 01–04 and 07–09 are resolved; [05 (PDF)](../.scratch/phase-1-5-audiobook-reader/issues/05-pdf-upload-support.md) and [06 (EPUB)](../.scratch/phase-1-5-audiobook-reader/issues/06-epub-upload-support.md) were never built and are still ready-for-agent_

## Problem Statement

Phase 1 shipped a working progressive reader: drop in a `.txt` file and it starts narrating almost immediately, with caching, a local library, and manual retry on failure. But a few real listening frictions remain once you actually use it day to day. If you miss a line or want to re-hear something, the only option is to replay the current chunk from its start — there's no way to jump to a specific sentence. There's no visual indicator of which sentence is currently being narrated, so following along with the text while listening isn't possible. The interface itself is a bare, functionally-correct Chakra-default scaffold with a single play/pause button — it doesn't feel like a real media player. And the reader is stuck with one hardcoded voice, one playback speed, and `.txt`-only input.

## Solution

Phase 1.5 builds directly on two things Phase 1 intentionally over-built in preparation for this: the word-level boundary timing metadata already persisted alongside every chunk's audio, and the Chakra semantic token scaffold. The first increment — and the first ticket of this phase — is **jump-to-any-sentence seeking with auto-scroll highlighting**: sentence-level start/end offsets are derived from the existing per-chunk boundary metadata (no new TTS calls or storage), the currently-playing sentence is highlighted in sync with playback, the view auto-scrolls to keep it visible, and clicking any sentence — including one in an already-uploaded but not-yet-generated chunk — seeks playback there directly.

Later tickets in this phase round out the rest of the listening experience: a Spotify/YouTube-style visual redesign (persistent player bar, real scrubber, polished layout) built on top of the semantic token scaffold, a voice picker, adjustable playback speed, additional file formats (EPUB, PDF), and a light/dark theme picker. These are scoped below at the level Phase 1 already committed to in its "Out of Scope" section; their finer implementation details are intentionally left open pending their own ticket-planning pass (see Further Notes).

## User Stories

1. As a reader, I want the currently-narrated sentence highlighted in the text, so that I can follow along visually while listening.
2. As a reader, I want the view to auto-scroll to keep the highlighted sentence visible, so that I don't have to manually scroll to keep up during long chunks or books.
3. As a reader, I want to click any sentence in the text to jump playback there directly, so that I can re-hear a specific line or skip ahead without replaying an entire chunk.
4. As a reader, I want jumping to a sentence in a not-yet-generated chunk to trigger that chunk's generation immediately, so that seeking ahead doesn't force me to first play through every chunk in between.
5. As a reader, I want a media-player-style interface — a persistent player bar, a real progress scrubber, clear controls — so that the app feels like a real audio/video player (e.g. Spotify, YouTube) rather than a bare functional scaffold.
6. As a reader, I want to choose the narration voice from a small set of options, so that I'm not stuck with a single hardcoded voice.
7. As a reader, I want to adjust playback speed, so that I can listen faster or slower depending on the material.
8. As a reader, I want to upload EPUB and PDF files in addition to `.txt`, so that I can listen to books in the formats I actually have.
9. As a reader, I want to switch between light and dark (or other) themes, so that the app matches my preference, using the token scaffold already in place from Phase 1.
10. As a developer, I want sentence boundaries derived entirely from the existing per-chunk word-boundary metadata, so that this feature adds no additional `edge-tts` calls or storage.

## Implementation Decisions

### Ticket 1 — Jump-to-any-sentence seeking + auto-scroll highlighting (fully decided; grounded in the current codebase)

- **No native sentence boundaries exist.** `edge-tts-universal`'s `synthesize()` only returns word-level `WordBoundary` entries (`{ text, offset, duration }`, in 100-nanosecond units) — already mapped 1:1 and persisted per chunk in Phase 1 (`app/_lib/edgeTtsClient.js` → `boundaries`, stored via `app/_lib/blobStorageClient.js` and already returned as-is by `POST /api/audio-chunks`). There is no sentence-level timing to consume as-is.
- **Deriving sentence boundaries:** re-run the same sentence-splitting rule `chunkText` already uses internally (`app/_lib/chunkText.js`'s `SENTENCE_PATTERN` / `splitIntoSentences`, currently private to that module — export it or extract a shared helper) against the chunk's own text to get its ordered sentence strings, then walk the chunk's word-boundary list in order, greedily assigning consecutive words to each sentence until their concatenated text matches it. A sentence's derived start = its first word's `offset`; its derived end = its last word's `offset + duration`. This is a pure function of (chunk text, word boundaries) → ordered sentence spans, with no dependency on playback state — unit-testable the same way `chunkText` is.
- **Highlighting:** driven by the `<audio>` element's `timeupdate` event (already wired via `audioRef` in `useBookPlayer`), compared against the derived sentence-span list for the currently-loaded chunk to find which span contains the current time. The active sentence gets a highlighted style via a new semantic token (e.g. `active-sentence-bg`/`active-sentence-fg`) added to the existing Chakra token scaffold (`app/_providers/chakra.jsx`) — not a separate polling timer.
- **Auto-scroll:** when the highlighted sentence changes, scroll it into view (`scrollIntoView({ block: 'center', behavior: 'smooth' })` or equivalent). Manual scrolling by the reader should temporarily suspend auto-scroll rather than fight them; exact resume behavior (idle timeout vs. an explicit "resume following" affordance) is a UX call to finalize during the ticket, not pre-decided here.
- **Seeking:** clicking a sentence whose chunk is already loaded sets `audio.currentTime` to that sentence's derived start (converted to seconds). Clicking a sentence in a chunk that hasn't been generated yet must trigger that chunk's generation immediately — bypassing `chunkFetchPlan`'s sequential look-ahead ordering for this one request — and begin playback at that sentence's offset once the chunk is ready, without generating every chunk in between. `currentIndex` in `useBookPlayer` moves to the target chunk as part of this, same as normal chunk advancement.
- **Resume position stays chunk-level.** The library's persisted `resumeIndex` (`app/_lib/bookLibrary.js`) is not extended to sentence granularity in this ticket — sentence position is a within-session seek target only, re-derived from cached boundary metadata whenever a chunk is loaded, since that's cheap and needs no new persisted state. Revisit only if usage shows chunk-level resume feels too coarse.

### Later tickets (scoped, details deferred to their own ticket-planning pass)

- **Spotify/YouTube-style visual redesign**: a persistent bottom (or side) player bar, a real progress scrubber (not just play/pause), and an overall layout restructure — built on the existing semantic token scaffold so it's primarily a component/layout change, not a new theming system. Concrete layout, component library choices beyond existing Chakra usage, and how it interacts with the sentence-highlighting view are open.
- **Voice picker**: a small, curated set of zh-TW voices (not the full `edge-tts` voice list) exposed as a picker; which voices, and whether voice becomes part of the audio cache key (it already can be — `audioGenerationService.js`'s `cacheKey` already includes `voice`) are open.
- **Playback speed control**: adjustable rate via the `<audio>` element's `playbackRate`; whether speed is persisted per-book or globally is open.
- **EPUB/PDF support**: parsing library choice and how chapter/section structure maps onto the existing flat chunk-index model are open.
- **Theme picker**: light/dark (or more) palette presets on top of the Phase 1 token scaffold, persisted per device alongside the existing library store; concrete palette values are open (Phase 1's spec already deferred "concrete palette and typography" to this phase).

## Testing Decisions

- Sentence-boundary derivation (chunk text + word boundaries → ordered sentence spans) is a pure function and should be unit tested in isolation the same way `chunkText` is — including edge cases like a sentence that maps to zero or one word, and boundary text that doesn't exactly reconstruct the sentence due to TTS normalization.
- Highlighting and auto-scroll behavior should be tested by simulating `timeupdate` events on a fake/mock `<audio>` element (as `AudioPlayer.test.jsx` already substitutes `data-testid="audio-element"`) and asserting the correct sentence span receives the active style — not by asserting on real audio playback timing.
- Seeking into a not-yet-generated chunk should be tested at the `useBookPlayer`/service level with fake clients (consistent with the existing Audio Generation Service test fakes), asserting that only the target chunk is generated, not every chunk in between.
- Later tickets (voice picker, speed control, EPUB/PDF, theme picker) will define their own testing decisions when scoped in detail.

## Out of Scope

- **Phase 2** (unchanged from the Phase 1 spec): Capacitor-based iOS/Android packaging, offline whole-book downloads, native background/lock-screen playback.
- Sentence-level resume position (persisting exactly which sentence, not just which chunk, a book was left on) — noted above as a possible future refinement, not committed to in this phase.
- Full `edge-tts` voice list exposure, or any non-Chinese voice/language.
- User accounts, authentication, or cross-device sync — still not planned.

## Further Notes

- This spec was written directly from a conversation with the user, not a `/grill-me` interview — only the first ticket (jump-to-sentence seeking + highlighting) has fully settled implementation decisions, grounded by reading the actual Phase 1 implementation (`app/_lib/edgeTtsClient.js`, `blobStorageClient.js`, `useBookPlayer.js`, `chunkText.js`, `chunkFetchPlan.js`). The remaining stories are scoped at the same level Phase 1 already committed to and will need their own decisions nailed down (ideally via `/grill-me` or an equivalent discussion) before being turned into tickets.
- Ticket ordering for this phase is: **01 — jump-to-any-sentence seeking + auto-scroll highlighting** first, per explicit user prioritization, ahead of the visual redesign and all other items above, even though the visual redesign was the user's original entry point into this phase.
