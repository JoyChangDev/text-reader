# Phase 1.7 — Reader Playback UX Polish

_Status: ready-for-agent_

## Problem Statement

Phase 1.6 turned the reader into a polished media player, but living with it day to day still surfaces friction. The player bar shows raw implementation detail (`Chunk x of xx`) instead of a Listener-meaningful position. The transcript and settings sheet show native scrollbars alongside the dedicated text-position indicator, which is redundant and looks unfinished. Auto-scroll to the now-playing sentence has a noticeable delay, making the transcript feel like it's lagging behind the audio. The Library only tracks resume position at Chunk granularity, so its progress display is coarse, and reopening a Book has no guarantee it won't start talking immediately. Pronunciation reporting currently hijacks whatever text the Listener happens to select mid-read, and its floating card can visually clash with normal reading and playback. And the UI itself is in English, despite the Listener's actual usage being in Traditional Chinese.

## Solution

Two concepts that are currently conflated get pulled apart everywhere they touch:

- **Reading position** — the saved (Chunk, Sentence) pair that playback resumes from. Only playback naturally advancing, or the Listener explicitly clicking a Sentence as the next playback target, updates it.
- **Text viewport position** — where the transcript is currently scrolled to, driven by manual scrolling or the bottom bar's position slider. Purely a browsing affordance; never persisted as reading position.

On top of that boundary:

- Auto-scroll snaps to the active Sentence immediately instead of using a smooth/animated scroll, so the transcript visibly keeps pace with narration.
- The Library records reading position at Sentence granularity (not just Chunk), so per-Book progress in the Library is a meaningful sentence-level percentage, with the existing Chunk-level data kept as a fallback for Books saved before this change.
- Opening a Book always seeds the player at the saved Sentence but never autoplays.
- The `Chunk x of xx` label and any `resumed at chunk x` copy disappear from the UI entirely.
- Transcript and settings-sheet scrollbars are hidden (scrolling itself is unaffected) so the bottom position indicator is the one visible position cue.
- The settings sheet's panel is capped at a comfortable reading width even on wide viewports, while its dimming overlay still covers the full screen.
- Pronunciation reporting becomes an explicit mode toggled from the bottom bar, separate from ordinary reading/playback: while it's active, Sentence-click seeking is disabled (so a report-mode tap can never move playback), arbitrary text selection is free to make (not gated to whatever a click would have targeted), and submitting opens a centered modal rather than a floating card.
- All visible UI copy and user-facing error messages move to Traditional Chinese.

## User Stories

1. As a Listener, I want auto-scroll to snap to the now-playing Sentence immediately, so that the transcript visibly keeps pace with the audio instead of trailing behind it.
2. As a Listener, I want manual scrolling to suspend auto-follow rather than fight it, so that I can read ahead or back without the view yanking back mid-scroll.
3. As a Listener, I want auto-follow to resume on its own a short while after I stop scrolling, so that I don't have to manually re-sync my place every time I glance ahead.
4. As a Listener, I want the bottom position slider to only move the transcript's scroll position, so that dragging it to browse never changes what Sentence playback will resume from.
5. As a Listener, I want each Book in my Library to show a Sentence-level percentage, so that my sense of "how far in am I" matches what I actually see on screen, not a coarse per-Chunk estimate.
6. As a Listener, I want a Book's progress to still show something sensible if it was saved before this Sentence-level tracking existed, so that older Library entries don't break or disappear.
7. As a Listener, I want opening a Book to land me on the Sentence I last reached, so that I don't have to re-scroll to find my place.
8. As a Listener, I want opening a Book to never start audio playing on its own, so that narration never starts unexpectedly (e.g. in a quiet room or with headphones not yet on).
9. As a Listener, I want pressing play right after opening a Book to resume from my exact saved Sentence, not just the start of the saved Chunk, so that I don't have to re-listen to Sentences I already heard.
10. As a Listener, I want the `Chunk x of xx` counter gone from the player bar, so that I'm not shown an internal implementation detail that means nothing to me as a reader.
11. As a Listener, I want the "resumed at chunk x" Library copy gone, so that the Library only ever talks about my progress in reader-facing terms (a percentage), never Chunk indices.
12. As a Listener, I want the transcript's scrollbar hidden, so that the bottom position indicator is the one visible cue for where I am in the text, instead of two competing indicators.
13. As a Listener, I want the settings sheet's scrollbar hidden too, so the sheet feels consistent with the transcript.
14. As a Listener, I want the settings sheet to stay a comfortable width even on a wide screen, so its controls don't stretch uncomfortably far apart.
15. As a Listener, I want the settings sheet's dimming backdrop to still cover the whole screen even though the panel itself is narrower, so the rest of the app still reads as "background, not interactive" while the sheet is open.
16. As a first-time Listener, I want the reader to default to the paper theme, so that my first impression matches the app's intended everyday look.
17. As a returning Listener, I want my previously chosen theme to still be respected, so that changing themes once doesn't get silently reset later.
18. As a Listener, I want all visible UI text in Traditional Chinese, so that the app matches the language I actually use it in.
19. As a Listener, I want error messages (failed audio generation, failed report submission, etc.) in Traditional Chinese too, so that when something goes wrong I can actually understand what happened.
20. As a Listener, I want a dedicated way to enter "report a pronunciation issue" mode from the bottom bar near the settings control, so that reporting is something I choose to do, not something that happens as a side effect of selecting text.
21. As a Listener, I want a clear way to cancel out of report mode without submitting anything, so that I can back out if I opened it by mistake.
22. As a Listener, I want to be able to select any arbitrary span of text while in report mode, so that I'm not limited to whatever a click would otherwise have targeted.
23. As a Listener, I want Sentence-click seeking disabled while report mode is active, so that trying to select text for a report can never accidentally move my playback position.
24. As a Listener, I want the pronunciation report form to appear as a centered modal, so that it reads as a deliberate, focused action rather than a floating card competing with the text I'm reading.
25. As a Listener, I want the report modal's submit button (「送出」) centered and its cancel button (「取消」) aligned to the right, so the modal's actions have a clear, consistent layout.
26. As a Listener, I want leaving report mode (via cancel or after a successful submission) to restore normal Sentence-click seeking, so the reader goes back to its regular playback behavior once I'm done reporting.
27. As a developer, I want reading-position persistence and viewport-scroll state kept in clearly separate code paths, so that a future change to one can't accidentally leak into the other.
28. As a developer, I want Books saved under the old Chunk-only resume format to keep working with the new Sentence-level code without a migration step, so that no existing Library data needs to be rewritten.

## Implementation Decisions

### Reading position vs. viewport position

- The existing separation already holds structurally: `TranscriptView`'s manual-scroll handling and `ScrollPositionIndicator`'s drag/click only ever touch the transcript's own `scrollTop` and never call into `useBookPlayer`'s Sentence-seeking (`seekToSentence`) or persistence effect. This phase extends persistence to Sentence granularity without disturbing that boundary — no viewport-only code path gains a persistence side effect.
- Reading-position persistence remains triggered from exactly two sources, both already present in `useBookPlayer`: natural playback advance (Chunk change today; Sentence change added by this phase) and an explicit Sentence click (`seekToSentence`). Because natural playback can advance the active Sentence roughly every few seconds, the persistence call is debounced/coalesced (e.g. save on a short trailing delay, or only when the Sentence index has settled) rather than firing a network write on every single Sentence boundary.
- Auto-scroll's `scrollIntoView` call switches from smooth to immediate (`behavior: 'auto'` or equivalent) so the transcript keeps pace with narration; the existing suspend-on-manual-scroll/resume-after-idle behavior (and its delay window) is unchanged.

### Sentence-level resume metadata

- The Library index summary (`library/index.json`, one entry per Book) gains two fields alongside the existing `resumeIndex`/`totalChunks`:
  - `resumeSentenceIndex` — the Sentence index within the resumed Chunk (defaults to `0`).
  - `sentenceCountsByChunk` — an array, one integer per Chunk, of how many Sentences that Chunk splits into. Computed once at `addBook` time via the same `splitIntoSentences` helper `TranscriptView` already uses for rendering, mirroring how `totalChunks` is already derived from `chunks.length` at that point — no extra Chunk-text read is needed later to compute progress.
- A Book's overall Sentence-level percentage is computed purely from this index-level data (no full-Chunk-text fetch required): a Sentence ordinal is `sum(sentenceCountsByChunk[0..resumeIndex-1]) + resumeSentenceIndex`, and percent is that ordinal over `sum(sentenceCountsByChunk) - 1`, clamped — the same shape of calculation `bookProgress.js` already does for Chunks today, just operating over Sentence counts.
- `updateResumeIndex` (client `bookLibrary.js` and server `libraryService.js`) is extended to accept and persist `resumeSentenceIndex` alongside `resumeIndex` in the same call — reading position is always saved as one atomic (Chunk, Sentence) pair, never as two separate writes that could disagree.
- Legacy fallback: Library entries persisted before this phase have `resumeIndex`/`totalChunks` but no `sentenceCountsByChunk`/`resumeSentenceIndex`. The progress helper falls back to today's Chunk-level percentage calculation for those entries (exactly the existing `summarizeBookProgress` behavior), rather than treating missing Sentence data as zero progress or erroring.

### Resume-without-autoplay

- Opening a Book seeds `useBookPlayer` with the saved `(resumeIndex, resumeSentenceIndex)` pair. On mount, the pending-seek mechanism `seekToSentence` already uses for a paused Sentence click (updates the active-Sentence highlight immediately; only actually seeks `audio.currentTime` once that Chunk's audio is loaded) is primed with this saved pair instead of defaulting to Sentence `0`. `wantsToPlay` stays `false` on mount as it already does today, so nothing plays until the Listener presses play — pressing play then resumes exactly at the saved Sentence rather than the start of the saved Chunk.

### Player bar and Library copy cleanup

- `PlayerBar`'s `Chunk {currentIndex + 1} of {totalChunks}` text is removed outright, with no replacement counter — the bottom position indicator is the only position cue left in the bar.
- `BookLibrary`'s "Resumed at chunk N" fallback copy (currently shown when a Book has `resumeIndex > 0` but no `totalChunks`/progress data) is removed; a Book with no usable progress data simply shows no progress line, matching how a genuinely never-opened Book already renders today.

### Scrollbar hiding

- `TranscriptView`'s scroll container and `PlayerSettingsSheet`'s sheet panel both get scrollbar-hiding styling (cross-browser: `scrollbar-width: none` plus a `::-webkit-scrollbar { display: none }` override) while keeping `overflow-y: auto` — scrolling by wheel, touch, keyboard, and the existing programmatic `scrollTop` writes (auto-scroll, "jump to now playing", the position slider) all continue to work unchanged. No other scrollable region in the app is touched.

### Settings sheet sizing

- `PlayerSettingsSheet`'s sliding panel gains `maxW="640px"` and horizontal centering, matching the `640px` reading-width convention `TranscriptView`/`PlayerBar` already use. The full-viewport dimming overlay behind it keeps its existing `inset={0}` (full screen), so only the interactive panel narrows, not the backdrop.

### Theme default (regression guard, no behavior change expected)

- `ColorModeProvider`'s existing `defaultTheme="paper"` (ADR 0002) already gives first-visit-default-paper plus persisted-choice-afterward via `next-themes`' own storage. This phase makes no code change here; it's called out as an explicit acceptance check so this behavior isn't accidentally broken by unrelated changes in this phase (e.g. the settings-sheet sizing work, which sits in the same component).

### Traditional Chinese translation

- Every user-visible string across the touched components — including but not limited to `AudioPlayer` ("Back to library"), `PlayerBar` (the audio-generation-failed alert), `PlayerSettingsSheet` ("Settings", "Narration voice", "Playback speed", "Appearance", "Close settings"), `PronunciationReportForm` (all labels, button text, and both success/error messages), `BookLibrary` ("Your library", "Delete …", "Completed") — is translated to Traditional Chinese, including `aria-label`s, since those are still user-facing (to screen readers) even when not visually rendered. Internal identifiers (`data-testid`, variable/function names, code comments) are unaffected.

### Pronunciation report mode

- A new explicit toggle lives in `PlayerBar` near `PlayerSettingsSheet`'s settings disclosure, entering/exiting a `report mode` boolean that's lifted to wherever `TranscriptView`'s Sentence-click gating already reads from (currently `isPlaying`, which disables clicking while a Chunk plays).
- While report mode is active, `TranscriptView` disables Sentence-click seeking unconditionally (regardless of `isPlaying`), on top of the existing playing-state gate — the two gates combine, they don't replace one another.
- Native text selection remains fully available while report mode is active and is not constrained to Sentence boundaries or click targets; selecting any non-empty span surfaces the report entry the same way it does today.
- `PronunciationReportForm` is restructured from its current absolutely-positioned floating card into a centered modal: a full-viewport dimming backdrop (same pattern `PlayerSettingsSheet`'s overlay already establishes) behind a centered form card, pre-filled with the selected phrase and the Book's title exactly as today.
- The modal's action row places 「送出」(submit) centered and 「取消」(cancel) aligned to the right — an explicit layout requirement, not left to either button's default alignment.
- The bottom bar's report-mode toggle also serves as the "cancel report mode" affordance (per story 21) — leaving report mode this way, or via the modal's own 「取消」, or after a successful submission, all restore ordinary Sentence-click seeking.
- Report mode has no effect on playback itself — audio keeps playing or stays paused exactly as it was; only Sentence-click seeking is additionally gated.
- No per-Sentence report shortcut (e.g. a context menu or inline icon) is added — the bottom-bar toggle remains the only entry point.

## Testing Decisions

Tests target the highest existing seam per concern — component tests for UI/interaction behavior, pure-function tests for calculations, service/route tests for persistence — rather than introducing new seams:

- `AudioPlayer.test.jsx`: opening a Book with a saved `(resumeIndex, resumeSentenceIndex)` renders at that Sentence without audio playing; natural playback advancing Sentences persists the new position (via the fake `data-testid="audio-element"` timeupdate simulation this file already uses); an explicit Sentence click persists immediately; simulated scroll or position-slider changes never trigger a persistence call.
- `BookLibrary.test.jsx`: a Book with Sentence-level metadata renders a Sentence-level percentage; a legacy Book (no `sentenceCountsByChunk`/`resumeSentenceIndex`) falls back to the existing Chunk-level percentage; no rendering path ever shows `Chunk`/`chunk` text.
- `TranscriptView.test.jsx`: the position slider/drag changes only the simulated `scrollTop` (JSDOM-settable, as this file already does) and never invokes the Sentence-click callback; auto-follow suspends on a simulated manual scroll and resumes after the idle delay (existing coverage), with the snap-to-active-Sentence call now asserted as immediate rather than smooth; Sentence-click is blocked when report mode is active, independent of `isPlaying`; scrollbar-hiding styling is present on the scroll container.
- `PlayerBar.test.jsx`: no `Chunk`/`chunk` text renders anywhere in the bar; the report-mode toggle renders near the settings disclosure and reflects/toggles report-mode state.
- `PlayerSettingsSheet.test.jsx`: the panel carries the `640px` max-width constraint while the backdrop overlay remains full-viewport; scrollbar-hiding styling is present on the panel.
- A (new) `PronunciationReportForm.test.jsx`: entering report mode and selecting text opens a centered modal (not the current floating-card markup); arbitrary selected text populates the form regardless of report-mode Sentence-click gating; submit/cancel actions render in the required centered/right-aligned layout; success and error copy render in Traditional Chinese; cancel and successful submission both exit report mode.
- `libraryService.test.js` / `bookLibrary.test.js`: `addBook` computes and persists `sentenceCountsByChunk` from the same per-Chunk text passed in; `updateResumeIndex` persists `resumeIndex` and `resumeSentenceIndex` together; a Book added before this phase's fields existed still reads back successfully (no missing-field errors) and still supports the existing Chunk-level operations.
- A pure Sentence-level progress helper (extending or sitting alongside `bookProgress.js`) is unit tested in isolation, the same way `bookProgress.js`'s existing percent calculation is tested today: correct percentage from `sentenceCountsByChunk` + resume position, clamping at both ends, the legacy (Chunk-only) fallback path, and edge cases (a single-Sentence Book, a Book with one Chunk, resume position at the very last Sentence).

## Out of Scope

- EPUB/PDF upload.
- Chapters, bookmarks, annotations, or a history timeline.
- Any change to TTS/audio generation itself.
- Automatic pronunciation correction or SSML overrides — reports remain for manual review only (unchanged from Phase 1.6).
- Redesigning the pronunciation report review workflow (the reviewer-facing list/report screen from the prior phase).
- Hiding scrollbars anywhere outside the transcript and settings sheet.
- Replacing Chakra UI or the current App Router route structure.
- A data-migration step for existing Library entries — legacy Chunk-only entries are read via fallback, never rewritten in place.

## Further Notes

- The core boundary this phase enforces: **reading position** affects playback and is the only thing ever persisted as progress; **text viewport position** is browsing state that lives entirely in the transcript's own scroll geometry and is never persisted. Every decision above (Sentence-level metadata, resume-without-autoplay, the slider staying viewport-only, report mode's Sentence-click gating) is a specific application of that one boundary.
- The theme-default story (16/17) is included as an explicit acceptance check rather than new work — see the "Theme default" decision above; no `ColorModeProvider`/ADR 0002 code change is expected.
- `sentenceCountsByChunk` is deliberately stored per-Chunk (not just a single `totalSentences` count) so that both the whole-Book total and the exact resume ordinal can be recovered from index-level data alone, without ever reading a Book's full Chunk text just to render Library progress — consistent with the two-tier storage shape (`library/index.json` vs. `library/<bookId>/chunks.json`) Phase 1.6 already established.
