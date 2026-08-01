# 05 — App branding: name, manifest, icon

**What to build:** Replace the default `create-next-app` branding with the app's own identity: title "text-reader," a generated `app/manifest.js`, and a simple headphone-motif icon set (no source artwork exists yet, so this is a placeholder good enough to replace the defaults). Consult `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` and `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` for this Next.js version's current conventions before implementing.

**Blocked by:** None — can start immediately, independent of the routing tickets

**Status:** ready-for-agent

- [ ] `app/layout.jsx`'s `metadata` export has `title: 'text-reader'` and a real (non-placeholder) `description`, replacing the `create-next-app` defaults.
- [ ] `app/manifest.js` exists, returning `name`/`short_name: 'text-reader'`, `display: 'standalone'`, `start_url: '/'`, `theme_color`/`background_color` matching the app's existing theme tokens, and an `icons` array pointing at the new icon assets.
- [ ] A simple headphone-motif icon is created (SVG source is fine) and exported at the sizes needed for a favicon and an apple-touch-icon (minimum 180×180 for the latter).
- [ ] Browser tab title shows "text-reader" instead of "Create Next App."
- [ ] Manually verified on the actual iOS device: re-adding (or refreshing) the Home Screen icon shows the new name and headphone icon, not the previous unexplained default.

## Comments
