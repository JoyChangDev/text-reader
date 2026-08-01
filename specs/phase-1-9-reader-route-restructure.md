# Phase 1.9 — Reader Route Restructure & Background Resilience Hardening

_Status: ready-for-agent_

## Problem Statement

Phase 1.8 (shipped 2026-07-31) added `visibilitychange`/MediaSession-driven reconciliation to `useBookPlayer`, on the assumption that the page's JS process survives backgrounding and just needs its React state corrected against the real `<audio>` elements on return. Testing the shipped build on iOS Safari (added to Home Screen) the next day shows the three original symptoms still occurring:

- Playback still stops after being backgrounded for a while (switching to another app).
- Returning to the reader still sometimes shows a play/pause state that doesn't match what's actually playing, or audio and the Sentence highlight disagree.
- The app sometimes lands back on the library screen with no explanation.

Investigation during grilling turned up the likely reason Phase 1.8 alone can't fix all of this: **this app has no persisted routing state at all.** `app/page.jsx` holds "which book is open" as a single in-memory `book` variable, initialized to `null` on every mount, with no reflection in the URL and no restoration from storage. `/pronunciation-reports` is a real Next.js route; the library and reader are not — they're two conditionally-rendered views of the same `/` route. Whenever the page gets a fresh mount for any reason — the OS discarding a backgrounded tab's process under memory pressure (confirmed as the likely trigger: the reported stoppage correlates with how long the app was backgrounded, not just whether it was backgrounded at all), or any other full reload — there is nothing to restore which book was open, so the app always lands on the library. This is a distinct failure mode from what Phase 1.8 addresses (same-process reconciliation), and no amount of hardening the `visibilitychange` handler can fix it, because a fully killed process has no JS state left to reconcile.

The same root cause was also spotted independently: tapping the "回報發音問題" (report pronunciation issue) toggle in the reader sometimes lands on the library screen too, even though nothing in that button's code path (`onToggleReportMode` is a pure local state toggle) calls back to the library. The working theory, to be confirmed once Phase 1.9 ships, is that this is the same process-kill-loses-everything failure surfacing at a different, coincidental moment — not a separate bug in the report feature.

Separately, this app has never had its own identity: `app/layout.jsx` still carries the default `create-next-app` title, there's no web manifest, and no icons — despite iOS already rendering the Home Screen shortcut in a chrome-less, standalone-looking mode (unexplained by anything in this codebase; worth making deliberate rather than leaving as an unexplained accident). There's also no loading feedback between "user picked/uploaded a file" and "playback screen is ready," which can read as the app being broken during that gap.

Finally, this repo runs a much newer Next.js (16.2.10) than commonly assumed; consult `node_modules/next/dist/docs` for current conventions (dynamic segments, the `params`-as-Promise change, the `app/manifest.js` convention) before implementing any ticket here, per `AGENTS.md`.

## Solution

### 1. Real routes for library and reader

Split the single `/` route into two real routes: `/` (library only) and `/book/[bookId]` (reader). `/pronunciation-reports` is unchanged. This replaces in-memory `book` state with the URL as the source of truth for "what screen am I on / which book am I reading," which is both a correctness fix (matches how the rest of the app already treats `/pronunciation-reports`) and a prerequisite for auto-restore (below) to have somewhere to redirect to.

### 2. Persist + auto-restore the last-open book

Because a killed-and-reloaded process has no in-memory state left, recovery has to come from something written to durable storage before the kill, read back at the next mount. A "last open book" pointer is written to `localStorage` whenever `/book/[bookId]` is entered, and cleared when the Listener explicitly presses "返回書庫" (an explicit choice to leave should be respected, not silently overridden next launch). On a fresh `/` mount, if that pointer is present, the app redirects straight into `/book/[bookId]` instead of showing the library — restoring the book and last-known position, but always in a **paused** state (iOS blocks non-gesture-initiated audio playback anyway, so optimistically showing "playing" here would just reintroduce the exact mismatch bug this phase is trying to eliminate). This is expected to also resolve the report-button symptom, as a side effect of the same mechanism rather than a separate fix.

### 3. Diagnostic visibility into the still-broken Phase 1.8 path

Phase 1.8's reconciliation logic can only be debugged against real iOS Safari background/suspend behavior, which can't be reproduced in this environment or in jsdom-based tests. There's also no Mac available for tethered Safari Web Inspector, so ordinary `console.log` output would be lost the moment the process is actually killed — precisely the case most worth debugging. Instead, a small on-screen panel logs key events (`visibilitychange`/`focus` firings, what the reconciliation checkpoint found and corrected, MediaSession registration status) to `localStorage` as they happen, and displays the persisted log on mount — so the last thing that happened before a kill is visible on the next launch without any tooling. This is temporary scaffolding for diagnosing ticket 04 and should be removed once that ticket ships.

### 4. App identity

Replace the default Next.js branding with the app's own: title "text-reader," a generated `app/manifest.js` (name, icons, `display: standalone`, theme colors), and a simple headphone-motif icon set (favicon + apple-touch-icon sizes) since no source artwork exists yet.

### 5. Loading feedback around book transitions

Two gaps get a loading state: `BookUploader` while `/api/chunks` is processing an uploaded file, and `/book/[bookId]` while `getBook` is fetching the book's chunks/resume position before `AudioPlayer` can render. Both currently have no visual feedback, which can read as the app hanging or being broken.

## User Stories

1. As a Listener, when the OS kills the app while I'm away and I come back, I want to land back in the book I was reading (paused, at my last position), not the library, so a background kill doesn't feel like data loss or a broken app.
2. As a Listener, if I explicitly go back to the library, I want the app to actually stay there next time I open it, not silently pull me back into the book I just left.
3. As a Listener, I never want to see a "playing" indicator when nothing is actually playing — restored sessions should honestly show paused until I tap play.
4. As a developer (Joy), I want visibility into what actually happened right before a background kill, without needing a Mac or remote debugger, so Phase 1.8's still-unresolved bug can be diagnosed from just my phone.
5. As a Listener, I want the app's icon and name on my Home Screen to say "text-reader" with a headphone icon, not generic Next.js branding.
6. As a Listener, I want some visual feedback while a file is uploading or a book is opening, so I don't think the app is frozen.

## Implementation Decisions

### Routing

- `app/page.jsx` is reduced to the library view only (`BookUploader`, `BookLibrary`, `BlobUsageIndicator`, the settings/report-link footer) — it no longer holds a `book` state variable.
- `app/book/[bookId]/page.jsx` is a new Client Component route rendering `AudioPlayer`. Consult `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` for this Next.js version's exact `params` shape (it's a Promise here; `useParams()` from `next/navigation` is likely the simpler fit for an already-`'use client'` tree, but confirm against the docs rather than assuming).
- This route fetches the book itself via `getBook(bookId)` (same function `handleSelectBook` calls today) rather than receiving `chunks`/`initialIndex` as props from a parent that already has them in memory — the parent (`/`) no longer has that state to hand off.
- `BookLibrary`'s `onSelect` and `BookUploader`'s `onReady` (after its `addBook` call persists the new book) navigate to `/book/[bookId]` via the router instead of calling `setBook`.
- `AudioPlayer`'s "返回書庫" button navigates to `/` for real (see [[phase-1-9-auto-restore]] for what also has to happen here) instead of calling an `onBackToLibrary` prop that just flips local state.
- If `getBook(bookId)` resolves to `null` (deleted book, bad link), redirect to `/` rather than rendering a broken player.

### Auto-restore

- On `/book/[bookId]` mount, write `{ bookId }` to a `localStorage` key (e.g. `lastOpenBook`) as the last-open pointer.
- The "返回書庫" action clears that key before navigating to `/`.
- `/`'s mount effect checks for the pointer; if present, it redirects to `/book/[bookId]` before rendering the library UI (avoid a flash of the library screen first).
- `/book/[bookId]` always initializes playback state as paused regardless of what was persisted or in-flight before a prior kill — this was already true of `useBookPlayer`'s existing initial state (`wantsToPlay` isn't itself persisted), so this decision is really "don't add anything that would make restored sessions auto-play," not new suppression logic.
- If the pointed-to book has been deleted (`getBook` returns `null` on the redirect target), clear the stale pointer and fall through to rendering the library normally instead of looping.

### Diagnostic panel (temporary)

- A small collapsible panel, always visible for now (single-user tool, no need to gate behind a flag), backed by a ring buffer in `localStorage` (cap it, e.g. last 50 entries, to avoid unbounded growth).
- Logged events: `visibilitychange` fires (with `document.visibilityState` + timestamp), `focus` fires, each reconciliation-checkpoint run (what it found vs. corrected: `isPlaying` mismatch, `activeSentenceIndex` correction, whether a missed chunk-advance was invoked), MediaSession registration outcome (`'mediaSession' in navigator` and whether handlers were attached).
- On mount, the panel renders whatever was already in the log before adding new entries, so the very last events before a kill are visible on the next launch.
- Include a manual "清除記錄" control.
- Tag this code clearly (e.g. a comment or a dedicated file) so it's easy to find and delete once ticket 04 ships.

### Branding

- `app/layout.jsx`'s `metadata` export: `title: 'text-reader'` (confirm current best-practice `description` wording with the user isn't specified — a short one-line description is fine).
- Add `app/manifest.js` per `node_modules/next/dist/docs/.../manifest.md` — `name`/`short_name: 'text-reader'`, `display: 'standalone'`, an icons array pointing at the new headphone icon assets, sensible `theme_color`/`background_color` matching the app's existing theme tokens.
- Generate a simple headphone-motif icon (no source art exists) as an SVG, exported at the sizes Apple/standard favicons need (at minimum a 180×180 apple-touch-icon and a favicon). Consult `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` for the current icon-file conventions in this Next.js version before hand-rolling paths.

### Loading states

- `BookUploader`: while `processFile`'s fetch to `/api/chunks` is in flight, disable the picker button and show a loading indicator/text (e.g. "處理中…") instead of leaving the dropzone static.
- `app/book/[bookId]/page.jsx`: show a loading state while `getBook` resolves, before `AudioPlayer` mounts. Consider whether this Next.js version's `loading.tsx` file convention (see `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`) is a better fit than local component state, given it's a dynamic route.

## Testing Decisions

- Routing: navigating from the library to a book, and back, is covered with the existing testing-library setup — assert on rendered content post-navigation rather than on router internals.
- Auto-restore: simulate a fresh mount of `/` with the `localStorage` pointer pre-set, assert it redirects to the reader rather than rendering the library; simulate a fresh mount with no pointer, assert the library renders; simulate a pointer whose book is missing, assert it clears and falls back to the library.
- Restored sessions: assert `isPlaying`/the play button state is paused immediately after a simulated restore, regardless of what was in storage.
- Diagnostic panel: assert events get appended to the `localStorage` log on `visibilitychange`/reconciliation, and that a fresh mount renders pre-existing log entries.
- Branding/manifest: a smoke test that `app/manifest.js` returns the expected shape is enough; visual icon correctness is verified manually on-device (see Further Notes).
- Loading states: assert the loading indicator is present during the pending fetch and gone once content renders, for both `BookUploader` and `/book/[bookId]`.

## Out of Scope

- Ticket 04 (hardening the actual Phase 1.8 reconciliation bug) cannot be fully specified yet — root cause requires real-device diagnostic data gathered via ticket 03's panel. That ticket is filed as `needs-info`, blocked on a round of on-device testing after ticket 03 ships.
- Any pursuit of indefinite/guaranteed background playback — out of reach for a web app regardless of routing or reconciliation fixes; that requires the native wrap planned for Phase 2, which is separately blocked on an unresolved AGPL licensing question and is not part of this phase.
- Time-windowed auto-restore (e.g., only restoring if the kill was "recent") — decided against; auto-restore always fires regardless of elapsed time, on the reasoning that the Home Screen icon should act as a shortcut back into what you were doing, and the explicit "返回書庫" escape hatch is one tap away if that's ever unwanted.
- Sourcing real brand artwork — the headphone icon built here is a placeholder good enough to replace default branding; swap it for real design assets later if wanted.

## Further Notes

- iOS Safari's Home Screen shortcut for this app already renders in a chrome-less, standalone-looking mode despite no manifest/`apple-mobile-web-app-capable` meta tag existing anywhere in this codebase or its `feature/deploy-vercel` branch history. This is unexplained by anything found during investigation. Adding the real manifest in this phase should make that behavior deliberate rather than leaving it as an accident; if on-device behavior changes unexpectedly once the manifest ships, that's worth a closer look rather than assuming it's equivalent to before.
- The core principle carried over from Phase 1.8 still holds and is extended here: React/URL state is a cache that's reliable while the process stays alive, and unreliable the moment it doesn't. Phase 1.8 built the reconciliation half of that (real `<audio>` elements as ground truth); this phase builds the persistence half (durable storage as ground truth for "what was I doing" once the process itself is gone).
