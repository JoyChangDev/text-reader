# Phase 1 — Text-to-Audiobook Reader (Web App)

_Status: done_

## Problem Statement

I have plain text files I want read aloud to me, like an audiobook, but there's no simple, free, personal tool that does this with decent-quality Chinese narration. Existing options are either low-quality (basic browser text-to-speech) or require a paid cloud TTS subscription and backend infrastructure I'd have to build and pay for just to try it out. I also want to be able to keep more than one book "in progress" at a time and pick up where I left off, without having to create an account just to use a personal tool.

## Solution

A Next.js web app where I drop in a `.txt` file and it starts reading the text aloud to me almost immediately, using a free, natural-sounding Traditional Chinese voice (via the open-source `edge-tts` service). Audio is generated progressively in small batches of sentences so I'm not waiting for the whole book to process before I hear anything, and every batch of generated audio is cached so re-listening or picking a book back up never re-generates audio I've already heard. I can upload multiple books and each one remembers its own reading position locally in my browser — no login required.

This is Phase 1 of a larger plan: a later phase adds more file formats, voice selection, sentence-level seeking, follow-along highlighting, and speed control (Phase 1.5), and a subsequent phase wraps this same app as a native iOS/Android app with offline downloads and lock-screen playback (Phase 2). Both are out of scope here — see "Out of Scope."

## User Stories

1. As a reader, I want to upload a `.txt` file, so that I can have its contents read aloud to me.
2. As a reader, I want playback to begin almost immediately after uploading, so that I don't have to wait for the entire book to be processed before I can start listening.
3. As a reader, I want the text to be read in natural-sounding groups of a few sentences at a time, so that the narration doesn't sound choppy or robotic at every sentence boundary.
4. As a reader, I want audio I've already heard to be cached, so that replaying a passage or resuming a book doesn't force it to be re-generated.
5. As a reader, I want the narration voice to be a natural Traditional Chinese (zh-TW) voice, so that pronunciation, tone, and pacing match my language.
6. As a reader, I want to keep a library of multiple uploaded books, so that I can switch between several texts I'm reading without losing progress on any of them.
7. As a reader, I want each book in my library to remember my reading position, so that reopening a book resumes exactly where I left off.
8. As a reader, I want to use the app without creating an account or logging in, so that there's zero friction to start listening.
9. As a reader, I want to see a clear error state if a piece of audio fails to generate, so that I know something went wrong rather than assuming silence means the book has ended.
10. As a reader, I want to manually retry a failed audio generation, so that a transient failure doesn't permanently block me from continuing that book.
11. As a reader, I want basic playback controls (play/pause), so that I can stop and resume listening at will within a session.
12. As a developer, I want the app deployed on real hosting rather than only running locally, so that the pipeline can be exercised and used from any browser, not just my own machine.
13. As a developer, I want generated audio persisted in cloud object storage, so that it survives redeploys and can be reached later by a native mobile app in Phase 2.
14. As a developer, I want the `edge-tts` integration to run in pure JavaScript/TypeScript inside the Next.js backend, so that no additional runtime (e.g. Python) needs to be installed, deployed, or maintained.
15. As a developer, I want a single Audio Generation Service seam between the app and its external dependencies (the `edge-tts` client and the object storage client), so that the rest of the app's behavior can be tested without making real network calls in every test.
16. As a developer, I want the visual theme wired through Chakra UI's semantic token system from the start, so that a future color theme change only requires editing token values, not touching component code.

## Implementation Decisions

- **TTS engine**: self-hosted `edge-tts` — an open-source integration with Microsoft Edge's "Read Aloud" service. Free to use, but unofficial/reverse-engineered (not a published, supported API) — see Further Notes for the stability/licensing caveat.
- **TTS integration**: a pure Node/TypeScript port of `edge-tts` (e.g. `edge-tts-universal`), called directly from Next.js API routes. No Python runtime or subprocess management.
- **Audio Generation Service (the one seam)**: a single server-side module sitting between the rest of the app and the two external dependencies (the `edge-tts` client, the object storage client). Its public interface is roughly "given a book, a chunk index, and a voice, return that chunk's audio URL and boundary-timing metadata," internally handling: check cache → on miss, call `edge-tts` → persist audio + metadata to storage → return. All API routes and UI code depend only on this module's interface, never on the `edge-tts` or storage clients directly.
- **File input**: `.txt` only. The file is read client-side as plain UTF-8 text (no server-side parsing needed) and sent to the backend for chunking and generation.
- **Chunking**: text is split into chunks of roughly 2–4 sentences, bounded by a max character count, using Chinese sentence-ending punctuation (`。`, `！`, `？`) as the split points (Chinese text has no whitespace to split on). Each chunk is the addressable unit for both generation and caching.
- **Boundary metadata**: `edge-tts` returns `WordBoundary`/`SentenceBoundary` timing metadata (offset + duration) alongside the generated audio for each chunk. This metadata should be persisted alongside the cached audio in Phase 1, even though the UI features that consume it (sentence highlighting, jump-to-sentence) are Phase 1.5 — capturing it now avoids a costly re-generation pass later just to obtain it.
- **Playback model**: progressive, not a single stitched file. The client requests and plays chunk audio sequentially, generating a small look-ahead buffer of upcoming chunks in the background rather than the whole book at once. A custom sequential-chunk player manages this queue; it is not a single native `<audio>` element pointed at one long file.
- **Caching**: generated audio and its boundary metadata are persisted in object storage, keyed by (book id, chunk index, voice id). Once a book has been read through once, all of its chunks are cached — replays and scrubbing backward are served from cache with no further `edge-tts` calls.
- **Voice**: one fixed, hardcoded default zh-TW voice for all generation in Phase 1. No voice-selection UI.
- **Library & progress persistence**: no user accounts or backend database. The library (list of uploaded books, each with its resume chunk index and per-chunk cache status) is persisted in the browser's local storage, scoped per device. Uploading a new file adds a new library entry; it does not replace existing ones.
- **Resilience**: if a chunk's audio generation fails, the specific chunk enters a visible error state in the UI and the reader can manually retry it. No automatic retry-with-backoff and no fallback to a secondary TTS engine in Phase 1.
- **Hosting & storage provider**: deployed on Vercel; generated audio and metadata are stored in Vercel Blob. No custom server process and no database beyond the browser-local library store.
- **Theming**: Chakra UI v3's `createSystem`/`defineConfig` (already scaffolded in the app's Chakra provider) is extended with custom semantic tokens (e.g. background/foreground/accent-style token names) so components reference token names rather than raw color values. The concrete palette and typography choices are deferred to Phase 1.5 — Phase 1 can ship with Chakra's default look as long as the token architecture is in place.

## Testing Decisions

- Good tests here assert on external, observable behavior of the Audio Generation Service's interface — e.g. "requesting the same chunk twice returns the cached result without a second generation call," "a failed generation surfaces an error rather than throwing," "chunking a given text produces the expected sentence groupings" — not on internal implementation details like the exact request shape sent to `edge-tts`.
- The `edge-tts` client and the object storage client should be substituted with lightweight fakes at the Audio Generation Service boundary for tests. No test should make a real network call to the unofficial `edge-tts` endpoint or to real Vercel Blob storage.
- Chunking (splitting Chinese text into punctuation-bounded groups of 2–4 sentences under a character cap) is pure, deterministic text processing and should be unit tested directly as a standalone function, independent of the service module.
- The library/progress persistence layer should be tested against its own public interface (add a book, read/update resume position, list library entries), not by asserting on raw local-storage keys or shapes.
- Prior art: none yet — this is a fresh scaffold with no test runner configured. Implementing this feature will also mean establishing the project's first test setup (a runner such as Vitest, consistent with the existing Next.js/React/ESLint/Prettier tooling already in the repo).

## Out of Scope

- **Phase 1.5** (a follow-up spec once Phase 1 ships): additional file formats (EPUB, PDF), a user-facing voice picker, jump-to-any-sentence seeking, auto-scroll sentence highlighting synced to playback, adjustable playback speed control, finalizing the concrete visual design/color palette, and a reader-facing theme picker (e.g. light/dark or multiple palette presets, persisted per device alongside the existing library store) built on top of the semantic token scaffold from Phase 1.
- **Phase 2** (a follow-up spec once Phase 1.5 ships): wrapping the app with Capacitor for iOS/Android native packaging and app store publishing, an explicit "download whole audiobook" action for on-device offline storage, and native background/lock-screen audio playback (media session integration, Android foreground service).
- User accounts, authentication, and cross-device library/progress sync are not planned for the current roadmap.
- Automatic fallback to a secondary TTS engine (e.g. the browser's native Web Speech API) if `edge-tts` repeatedly fails.
- Any language/voice beyond the single default zh-TW voice.

## Further Notes

- `edge-tts` is an unofficial, reverse-engineered integration with Microsoft's Edge "Read Aloud" service, not a published or supported public API — Microsoft could change or break the underlying endpoint without notice. Most Node/TypeScript ports of it are GPLv3-licensed; confirm the license of whichever package is chosen (e.g. `edge-tts-universal`) is acceptable given the app will eventually be distributed via app stores in Phase 2.
- This spec was synthesized from a structured decision-tree interview (`/grill-me`) that also settled the shape of Phase 1.5 and Phase 2. Both are deliberately excluded here to keep this increment small, testable, and shippable, but the decisions behind them are already captured and should be turned into their own specs once Phase 1 ships.
- No issue tracker was configured for this repository at spec-writing time (`/setup-matt-pocock-skills` had not been run, and the GitHub CLI was unavailable in this environment), so this spec was written directly to the repository at `specs/phase-1-audiobook-reader.md` rather than published to an external tracker.
