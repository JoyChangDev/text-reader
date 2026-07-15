# 02 — Semantic token theming scaffold

**What to build:** Extend the existing Chakra UI `createSystem`/`defineConfig` setup with a set of custom semantic tokens (e.g. background, foreground, accent-style token names) so that components can reference token names instead of raw color values. This is architecture only — the concrete palette and typography are decided later (Phase 1.5); the app should look visually unchanged (Chakra defaults) after this ticket.

**Blocked by:** None — can start immediately, independent of the TTS pipeline work

**Status:** ready-for-agent

- [ ] The Chakra provider's `defineConfig` includes a custom semantic token set (at minimum background/foreground/accent-style names)
- [ ] At least one component in the app is updated to consume a semantic token name rather than a raw color value, demonstrating the pattern
- [ ] Swapping a semantic token's value in the config visibly changes that component's rendered color, with no other code changes required
- [ ] The app's visual appearance is otherwise unchanged from Chakra's defaults
