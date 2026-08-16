# Phase 1.6 — Listening Polish & Shared Library

_Status: done — all ten tickets resolved_

## Problem Statement

Phase 1.5 turned the reader into a real media player: sentence-level seeking, a voice picker, playback speed, a persistent player bar, and a whole-book progress scrubber. Living with it day to day surfaces a new set of frictions. Controls and text stay clickable mid-playback, so an accidental tap on a sentence or the voice picker derails what's currently playing. There's no quick way to preview a voice before committing to a book, since preview only lives inside the player. If a listener scrolls ahead in the transcript to read, there's no quick way back to where playback actually is. The whole-book scrubber's real/estimated-duration model is more machinery than the listener actually wants — they just want to see where they are in the text. Chunk-to-chunk playback has an audible gap. Generated audio accumulates in Vercel Blob forever with no cleanup, risking the Hobby plan's storage cap (which, once exceeded, blocks Blob access for 30 days). The Library is device-local, so a book started on one device can't be resumed on another. And there's no way to flag a mispronounced word for later review.

## Solution

A batch of listening-experience and infrastructure improvements, built on the existing Chunk/Chunk-audio/Listener/Library vocabulary:

- Voice preview is available before a book is even opened, not just inside the player.
- Playback locks the voice/speed controls and sentence-click seeking while a Chunk is actively playing; pausing unlocks them. Selecting a sentence while paused sets where the _next_ play will start, rather than immediately playing.
- A "jump to now playing" control scrolls the transcript back to the active sentence on demand.
- The whole-book scrubber is replaced by a much simpler text-scroll-position indicator, fully decoupled from audio duration/timing.
- The next Chunk's audio is buffered ahead of time so playback advances without an audible gap (independent of any silence baked into the TTS audio itself, which is out of scope here).
- Generated Chunk audio is cleaned up automatically (cascade delete on Book removal, plus a daily sweep of anything untouched for 7+ days) and a capacity indicator plus manual "clean up now" control gives the Listener visibility and control.
- The Library (a Book's Chunk text and resume position) moves from device-local `localStorage` to Vercel Blob, so any device can open and resume any Book. This is a deliberate, temporary trade-off: there is no account system yet, so the Library is effectively public (anyone with the URL can see and resume any Book) and `resumeIndex` is a single shared value per Book (last write wins across devices/listeners). Acceptable now because the app has a single Listener; revisit before this app has more than one.
- A lightweight pronunciation issue report form lets the Listener flag a mispronounced word (Book title, the selected phrase, an optional description, a server-assigned timestamp) for manual review later — no automatic pronunciation correction in this phase.

## User Stories

1. As a Listener, I want to preview available voices from the upload/library screen, so that I can choose a voice before I even open a Book.
2. As a Listener, I want the voice and speed controls disabled while a Chunk is playing, so that I don't accidentally change them mid-sentence.
3. As a Listener, I want sentence-click seeking disabled while a Chunk is playing, so that an accidental tap on the transcript doesn't derail playback.
4. As a Listener, I want to still be able to scroll freely through the transcript while a Chunk is playing, so that I can read ahead or back without it affecting playback.
5. As a Listener, I want the voice/speed controls and sentence-click seeking to unlock as soon as I pause, so that I can make changes between Chunks or listening sessions.
6. As a Listener, I want clicking a sentence while paused to set where playback will start next, without immediately starting playback, so that I can queue up where I want to resume before I'm ready to press play.
7. As a Listener, I want a visible indication of which sentence is queued to play next when I've selected one while paused, so that I know what will happen when I press play.
8. As a Listener, I want a button that scrolls the transcript back to the currently-playing sentence, so that I can get back to my listening position after scrolling away to read ahead.
9. As a Listener, I want a simple visual indicator of how far through the whole Book's text I've scrolled, so that I have a sense of overall progress without needing exact audio timing.
10. As a Listener, I want to drag or click that text-position indicator to scroll the transcript, so that I can jump to a rough position in the text quickly.
11. As a Listener, I want that indicator to be purely about text position, not audio playback position, so that it doesn't need any Chunk-duration bookkeeping to work.
12. As a Listener, I want the next Chunk's audio to already be buffered by the time the current one ends, so that I don't hear a gap between Chunks.
13. As a Listener, I want Chunk audio to be deleted automatically once I remove a Book from my Library, so that I'm not paying (in storage) for Books I no longer want.
14. As a Listener, I want Chunk audio that hasn't been touched in a while to be cleaned up automatically even if I never explicitly delete the Book, so that storage doesn't grow unbounded from Books I abandoned or finished and never revisit.
15. As a Listener, I want to see roughly how full the Blob storage is, so that I have visibility into whether I'm approaching a plan limit.
16. As a Listener, I want a button to trigger the cleanup sweep immediately, so that I can free up space on my own schedule rather than waiting for the daily automatic sweep.
17. As a Listener, I want a Book I upload on one device to show up and be resumable from any other device, so that I'm not stuck finishing a Book on the device I happened to upload it from.
18. As a Listener, I want my resume position for a Book to update no matter which device I was last listening on, so that switching devices mid-Book picks up close to where I left off.
19. As a Listener, I want to flag a word that was mispronounced, including which Book it was in and which specific phrase, so that it can be reviewed later.
20. As a Listener, I want to optionally add a short description when reporting a pronunciation issue, so that I can give more context if it's useful.
21. As a Listener, I want the pronunciation report to record when I submitted it, so that older, possibly-already-fixed reports can be told apart from recent ones.
22. As a developer, I want every new feature that touches Vercel Blob (Library storage, cleanup sweep, capacity reporting, pronunciation reports) to go through one shared, injectable storage-client seam, so that all of it can be tested against a fake client the same way `audioGenerationService.js` already is, without hitting real network/storage in tests.
23. As a developer, I want the Library's client-facing interface (`listBooks`, `addBook`, `getBook`, `updateResumeIndex`, and a new `deleteBook`) to stay shape-compatible with today's `bookLibrary.js`, so that call sites change as little as possible even though the underlying storage moves from `localStorage` to a server API.

## Implementation Decisions

### Shared storage seam

- `blobStorageClient.js`'s interface grows two methods alongside the existing `get`/`put`: `del(key)` (wraps `@vercel/blob`'s `del`) and `list(prefix)` (wraps `list`, returning each blob's pathname, size, and `uploadedAt`). Every new server-side module below depends on this one interface via constructor injection, exactly as `audioGenerationService.js` already injects `storageClient`/`ttsClient` — no feature gets its own bespoke Blob integration.

### Library becomes a server-backed, shared store

- New `libraryService.js` (parallel to `audioGenerationService.js`): `listBooks()`, `addBook({ bookId, title, chunks })`, `getBook(bookId)`, `updateResumeIndex(bookId, resumeIndex)`, `deleteBook(bookId)`.
- Storage shape, two tiers to avoid paying to download full Book text just to render the Library list:
  - `library/index.json` — a compact array of `{ bookId, title, resumeIndex }`, read/written on every Library-list or resume-index update.
  - `library/<bookId>/chunks.json` — the full Chunk text array, written once at upload, read once when a Book is opened.
- `deleteBook` removes the Book's entry from `library/index.json`, deletes `library/<bookId>/chunks.json`, and — via the shared `list`/`del` seam — deletes every `<bookId>/*` audio and metadata blob already covered by `audioGenerationService.js`'s cache key scheme. This is the cascade-delete behavior from story 13.
- `bookId` generation stays client-side (`crypto.randomUUID()`, as today) — no server-assigned IDs.
- Consistency model: read-modify-write against `library/index.json`, last-write-wins. No locking, no transactions. This is the accepted trade-off from the Solution section — acceptable for a single-Listener app, revisit if that changes.
- New routes: `GET /api/library` (list), `POST /api/library` (add), `PATCH /api/library/[bookId]` (update resume index), `DELETE /api/library/[bookId]` (cascade delete).
- `bookLibrary.js` becomes a thin client wrapper calling these routes instead of `localStorage`, keeping the same exported function names/shapes listed in story 23 (now async). Call sites (`BookLibrary.jsx`, `page.jsx`, `useBookPlayer.js`'s resume-index persistence effect) adapt to the functions now returning Promises.
- `listenerSettings.js` (device-scoped voice/speed prefs, ADR 0001) is unaffected — it stays in `localStorage`. Only Library data (Book list, Chunk text, resume position) moves server-side.

### Blob cleanup and capacity

- New `blobCleanupService.js`, both pure functions over data already fetched via the shared `list()`:
  - `planCleanup({ blobs, now, retentionDays = 7 })` → pathnames older than `retentionDays` (by `uploadedAt`), scoped to Chunk audio/metadata blobs only (never `library/*` or `pronunciation-reports/*`).
  - `computeUsagePercent({ blobs, quotaBytes })` → summed blob size ÷ quota.
- `quotaBytes` is configurable via an environment variable (default matching the Hobby plan's included storage) so it can be adjusted if the plan changes.
- `GET /api/blob-usage` → calls `list()`, returns `{ usedBytes, quotaBytes, percent }` for the capacity indicator.
- `POST /api/blob-cleanup` → runs `planCleanup` against `list()` output and deletes the resulting pathnames via `del`. This single route serves both the daily Vercel Cron trigger and the Listener-facing "clean up now" button.
- New `vercel.json` (none exists yet) declaring a daily cron: `{ "crons": [{ "path": "/api/blob-cleanup", "schedule": "0 3 * * *" }] }`.

### Playback lock / pending-start-sentence

- `useBookPlayer.js`'s `seekToSentence` no longer calls `setWantsToPlay(true)`. It still records `pendingSeekRef`, moves `currentIndex` if the target Chunk differs, and triggers that Chunk's generation if needed (unchanged from today) — it just no longer forces playback to start.
- Selecting a sentence while paused updates the active-sentence highlight and displayed position immediately (via the existing `applySeek`/`activeSentenceIndex` state), so the Listener sees what's queued (story 7), even before the target Chunk's audio has finished loading.
- Pressing play (`play()`, unchanged) sets `wantsToPlay(true)`; the existing "load and play" effect (gated on `isPlaying`) then applies the pending seek and begins playback from the selected sentence, once the target Chunk is ready.
- `PlayerBar.jsx`'s voice `NativeSelect` and speed `NativeSelect` gain a `disabled={isPlaying}` (name TBD at the component level).
- `TranscriptView.jsx`'s sentence `onClick` is only wired while not playing; scrolling remains unaffected either way (story 4).

### Jump to now playing

- `TranscriptView.jsx` already holds `activeSentenceRef` and the `scrollIntoView` call used for auto-scroll. A new button reuses that same ref/behavior on demand rather than only on sentence change.

### Text-scroll-position indicator (replaces the whole-book scrubber)

- `bookProgress.js` and its adaptive duration-estimation approach (ADR 0002) are removed entirely — nothing else depends on it once the scrubber no longer needs Chunk durations. `sentenceSpans.js`'s `deriveSentenceSpans`/`ticksToSeconds` are unaffected (still used for sentence-highlighting during playback, unrelated to the scrubber).
- New indicator is computed purely from the transcript container's scroll position: `scrollTop ÷ (scrollHeight − clientHeight)` → a percentage, with no Chunk-index or duration data involved at all.
- Draggable/clickable: interacting with the indicator sets the transcript's `scrollTop` directly from the target percentage. It only ever scrolls the transcript view — it never touches `audio.currentTime` or Chunk/sentence seeking.
- `PlayerBar.jsx` drops `ProgressScrubber`, `segments`, `totalSeconds`, `bookPositionSeconds`, and `onSeek`/`seekToBookOffset` entirely; `useBookPlayer.js` drops `timeline`/`buildBookTimeline`/`bookPositionSeconds`/`seekToBookOffset`.

### Chunk-to-chunk audio preloading

- `useBookPlayer.js` moves from a single `audioRef` to a ping-pong pair of `<audio>` elements: while the current Chunk plays, the next Chunk's actual audio (not just its metadata URL, which is already prefetched via the existing look-ahead) is loaded into the standby element as soon as it's known, so the browser buffers it in the background. On advance, the standby element (already buffered) becomes active instead of assigning a cold `src` to a single element.
- This addresses only the buffering/network-latency source of the inter-Chunk gap (see the Problem Statement) — it does not attempt to trim any silence baked into the TTS audio itself by edge-tts (see Out of Scope).

### Voice preview relocation

- The preview logic currently inline in `AudioPlayer.jsx` (`previewAudioRef`, `togglePreviewVoice`, `voiceSampleUrl`) is extracted into a shared piece (component and/or hook) usable both from the pre-book upload/library screen and from `PlayerBar.jsx`, so the same preview behavior isn't implemented twice.

### Pronunciation reporting

- New `pronunciationReportService.js`: `submitReport({ bookTitle, phrase, description })` appends `{ bookTitle, phrase, description, reportedAt }` (server-generated ISO timestamp — not user-supplied) to a stored list, via the shared storage seam.
- `POST /api/pronunciation-reports` calls `submitReport`.
- New form/affordance reachable from `TranscriptView`: the Listener selects a phrase in the rendered text (native browser text selection), a "report pronunciation issue" affordance appears near the selection, opening a small form pre-filled with the selected phrase and the current Book's title, plus an optional description field.
- No SSML `<phoneme>` override or any other automatic pronunciation change is implemented in this phase — reports are for manual review only.

## Testing Decisions

- Every new server-side service (`libraryService.js`, `blobCleanupService.js`, `pronunciationReportService.js`) is tested against a fake injected storage client, the same pattern `audioGenerationService.test.js` already establishes — no test hits real `@vercel/blob`.
- `planCleanup` and `computeUsagePercent` are pure functions and should be unit tested in isolation the same way `bookProgress.js`'s functions were (before removal) — fixed input data in, expected pathnames/percentage out, including boundary cases (exactly at the retention threshold, zero blobs, quota exactly reached).
- New API routes (`/api/library`, `/api/library/[bookId]`, `/api/blob-usage`, `/api/blob-cleanup`, `/api/pronunciation-reports`) are tested the same way `chunks/route.test.js` and `audio-chunks/route.test.js` already are — request in, response/status out, with the underlying service faked.
- Playback-lock, pending-start-sentence, jump-to-now-playing, and Chunk-preloading behavior are tested at the same component seam already established by `AudioPlayer.test.jsx`/`PlayerBar.test.jsx`/`TranscriptView.test.jsx` — simulating events on the fake `data-testid="audio-element"` (and its new standby counterpart) rather than asserting on real audio playback or timing.
- The text-scroll-position indicator is tested by simulating `scrollTop`/`scrollHeight`/`clientHeight` on the transcript container in `TranscriptView.test.jsx` (JSDOM-settable properties) and asserting the reported percentage and that dragging it sets `scrollTop` accordingly — no dependency on Chunk audio state at all.
- `bookLibrary.test.js` is rewritten against the new fetch-based client (mocking `fetch` to `/api/library*`) rather than `localStorage`; `libraryService.test.js` (server side) covers the actual persistence logic against the fake storage client.

## Out of Scope

- Any real account/authentication system — the Library is fully public/shared and `resumeIndex` is last-write-wins for this phase (see Solution). A future phase should introduce a lightweight account system before this app has more than one real Listener.
- Trimming silence baked into edge-tts's own synthesized audio (leading/trailing silence per independently-synthesized Chunk) — only the app-side buffering gap is addressed this phase.
- Automatically applying pronunciation corrections (e.g. an SSML `<phoneme>` override dictionary wired into `edgeTtsClient.js`) — this phase only collects reports for manual review.
- Any change to `listenerSettings.js`'s device-scoped voice/speed preference model (ADR 0001) — still per-device `localStorage`.
- Per-plan-tier-specific cleanup tuning beyond the configurable `quotaBytes`/`retentionDays` values — no special-casing for Hobby vs. Pro beyond that.

## Further Notes

- This spec was synthesized from a `/grilling` session, not written from scratch — every decision above (seam choice, cleanup strategy, retention window, Library publicness trade-off, pending-start-sentence behavior, cleanup-scope boundaries) was explicitly confirmed with the Listener rather than assumed.
- Worth a dedicated ADR once implemented: "Library is public/shared with no auth, `resumeIndex` is last-write-wins" — it reverses phase-1-5's stated Out-of-Scope position ("User accounts, authentication, or cross-device sync — still not planned") and carries real privacy implications the Listener explicitly accepted for the current single-Listener usage. Should be revisited before this app is used by more than one person.
- `bookProgress.js` and ADR 0002 are removed as part of this phase (confirmed with the Listener) rather than kept around unused.
- Vercel Blob's Hobby-plan behavior on exceeding usage limits is a hard block (no Blob access for 30 days), not a bill — this is the concrete motivation behind both the cleanup sweep and the capacity indicator, not just general storage hygiene.
