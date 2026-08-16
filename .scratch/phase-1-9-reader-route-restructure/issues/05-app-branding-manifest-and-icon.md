# 05 — App branding: name, manifest, icon

**What to build:** Replace the default `create-next-app` branding with the app's own identity: title "text-reader," a generated `app/manifest.js`, and a simple headphone-motif icon set (no source artwork exists yet, so this is a placeholder good enough to replace the defaults). Consult `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` for this Next.js version's current conventions before implementing.

**Blocked by:** None — can start immediately, independent of the routing tickets

**Status:** resolved — verified on the device 2026-08-16. The Add to Home Screen sheet pre-filled `text-reader` and previewed the headphone glyph, and the saved Home Screen icon matches. Two things this ticket's criteria did not cover turned up while verifying it, both fixed here rather than deferred — see "What the device check found" below.

- [x] `app/layout.jsx`'s `metadata` export has `title: 'text-reader'` and a real (non-placeholder) `description`, replacing the `create-next-app` defaults.
- [x] `app/manifest.js` exists, returning `name`/`short_name: 'text-reader'`, `display: 'standalone'`, `start_url: '/'`, `theme_color`/`background_color` matching the app's existing theme tokens, and an `icons` array pointing at the new icon assets.
- [x] A simple headphone-motif icon is created (SVG source is fine) and exported at the sizes needed for a favicon and an apple-touch-icon (minimum 180×180 for the latter). Implemented as `app/icon.js`/`app/apple-icon.js` (generated via `next/og`'s `ImageResponse`), sharing one glyph definition in `app/_lib/headphoneGlyph.jsx` so the two sizes can't drift apart.
- [x] Browser tab title shows "text-reader" instead of "Create Next App."
- [x] Also added (beyond this ticket's original checklist, surfaced during code review): `app/layout.jsx`'s `metadata.appleWebApp` (`title`/`statusBarStyle: 'black-translucent'`). Not originally listed here, but directly serves the PRD's Further Notes goal of making the already-observed iOS standalone behavior deliberate rather than an unexplained accident - kept rather than reverted, and recorded here so the ticket matches what actually shipped.
- [x] Manually verified on the actual iOS device: re-adding (or refreshing) the Home Screen icon shows the new name and headphone icon, not the previous unexplained default. Verified 2026-08-16 — the Add to Home Screen sheet pre-filled the name and previewed the glyph, and the saved icon matches.
- [x] Added while verifying the above: the create-next-app `favicon.ico` is deleted, and the OS lock screen is handed explicit Now Playing artwork instead of being left to guess. See "What the device check found".

## Comments

### What the device check found

The criterion passed on the first try. Two things around it did not, and neither was covered by
any criterion here — this ticket asked about the Home Screen and the browser tab title, and said
nothing about the two other places an OS goes looking for an app's picture.

**`app/favicon.ico` was still the create-next-app default.** 25,931 bytes, added by
`4418576 Initial commit from Create Next App` and never modified since. The ticket's own headline
is "Replace the default create-next-app branding", and this was the last piece of it still
shipping — emitted first in `<head>`, ahead of the generated `/icon`, so the browser tab was
plausibly still showing the Next.js logo. Deleted. The tab now falls to `/icon`, the 32px
headphone. A bare `GET /favicon.ico` now 404s, which is what every site without a root favicon
does and is not a defect: the `<link rel="icon">` is what a browser actually uses.

**The lock screen showed that same default while the Home Screen showed the glyph** — the
symptom that made the first one worth finding. `useMediaSession.js` set
`new MediaMetadata({ title })` with no `artwork`, so iOS went looking for a page icon on its own
and found `favicon.ico`. The Home Screen reads `apple-touch-icon`; Now Playing does not. Two
fallbacks, two different files, one of them stale.

Deleting the favicon would have fixed the symptom by accident — the fallback would have landed on
`/icon` instead. Declaring the artwork is the actual fix, so `app/media-artwork/route.js` serves
a 512×512 PNG and `MediaMetadata` names it. 512 because the iPhone lock screen renders Now Playing
artwork far larger than the 180×180 `apple-icon` would have survived.

**All three sizes still come from one glyph.** `headphoneGlyph.jsx` was already shared by
`icon.js` (22/32) and `apple-icon.js` (124/180); the artwork uses the same 0.688 proportion, and
the rendered PNG measures 0.543 of the frame against `apple-icon`'s 0.544. That was the point of
sharing the definition, and it survived a third consumer.

A test pins the `artwork` entry, because the failure mode is invisible: with no artwork the OS
still shows _something_, so nothing looks broken until you notice it is the wrong picture.
