# 09 — Theme picker (Light/Dark/System)

**What to build:** The Listener can switch between light, dark, and system-following
theme, applied across the whole app including the new player bar.

**Blocked by:** 07

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] `next-themes` is added as a dependency; a custom `ColorModeProvider` wraps the app
      per the Chakra v3 pattern (Chakra v3 has no built-in `ColorMode`/`useColorMode`)
- [x] The semantic tokens in `chakra.jsx` (`background`, `foreground`, `accent`,
      `danger`, `activeSentenceBg`/`activeSentenceFg`) are converted from flat values to
      `{ _light, _dark }` pairs; concrete color values for each are decided as part of
      this ticket
- [x] A Light / Dark / System toggle is added to the `PlayerBar` (07); System follows
      the OS preference by default
- [x] Theme persistence uses `next-themes`' own storage mechanism, separate from
      `listenerSettings` (per ADR 0001's documented exception) — no flash of incorrect
      theme on page load
- [x] Tests cover: token resolution in both light and dark modes, and that the toggle
      correctly switches `next-themes`' active theme

## Comments

- `ColorModeProvider` (`app/_providers/colorMode.jsx`) wraps next-themes' `ThemeProvider`
  with `attribute="class"` — required because Chakra v3's `_dark` semantic-token
  condition resolves to the `.dark &` selector, not next-themes' own `data-theme`
  default.
- Concrete color values chosen: `background` white/gray.950, `foreground`
  gray.900/gray.50, `accent` blue.600/blue.300, `danger` red.600/red.400,
  `activeSentenceBg` yellow.200/yellow.600, `activeSentenceFg` black/black
  (light/dark respectively).
- The toggle lives in `app/_components/ThemeToggle.jsx`, wrapped in Chakra's
  `ClientOnly` (the documented Chakra v3 + next-themes pattern) since the persisted
  theme is only known after mount.
- No-flash-on-load verified by inspecting the SSR HTML directly: next-themes' blocking
  inline script (`attribute=class`, `storageKey=theme`, `defaultTheme=system`) is
  emitted immediately after `<body>`, before any app content.
- Could not click through the toggle in an actual rendered browser — no headless
  browser tooling (Playwright/Chromium) was available in this environment. Verified
  instead via jsdom-based DOM assertions (`ThemeToggle.test.jsx` asserts
  `document.documentElement`'s class actually flips), the raw SSR HTML output, and a
  successful `next build`.
