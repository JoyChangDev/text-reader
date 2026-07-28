# 09 — Theme picker (Light/Dark/System)

**What to build:** The Listener can switch between light, dark, and system-following
theme, applied across the whole app including the new player bar.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `next-themes` is added as a dependency; a custom `ColorModeProvider` wraps the app
      per the Chakra v3 pattern (Chakra v3 has no built-in `ColorMode`/`useColorMode`)
- [ ] The semantic tokens in `chakra.jsx` (`background`, `foreground`, `accent`,
      `danger`, `activeSentenceBg`/`activeSentenceFg`) are converted from flat values to
      `{ _light, _dark }` pairs; concrete color values for each are decided as part of
      this ticket
- [ ] A Light / Dark / System toggle is added to the `PlayerBar` (07); System follows
      the OS preference by default
- [ ] Theme persistence uses `next-themes`' own storage mechanism, separate from
      `listenerSettings` (per ADR 0001's documented exception) — no flash of incorrect
      theme on page load
- [ ] Tests cover: token resolution in both light and dark modes, and that the toggle
      correctly switches `next-themes`' active theme

## Comments
