# 03 — Settings sheet visual polish: width cap & hidden scrollbar

**What to build:** Cap the settings sheet's sliding panel at a comfortable reading width (640px, matching the transcript/player-bar convention) and center it, while its dimming backdrop still covers the full viewport. Hide the panel's native scrollbar while scrolling still works. Confirm (regression check, no code change expected) that first-visit-defaults-to-paper and persisted-theme-choice still hold.

**Blocked by:** None — can start immediately

**Status:** resolved — built and in the code, confirmed against the codebase on 2026-08-12. The boxes below were never ticked: that is unfilled paperwork, not open work. They have not been audited line by line, so trust the code over the checkboxes here.

- [ ] The settings sheet panel has a `640px` max-width and is horizontally centered.
- [ ] The dimming overlay behind the panel still covers the full viewport (`inset: 0`), independent of the panel's narrower width.
- [ ] The settings sheet panel has no visible scrollbar, while its content remains scrollable when it overflows.
- [ ] `PlayerSettingsSheet.test.jsx` asserts the `640px` max-width constraint on the panel, the full-viewport overlay, and scrollbar-hiding styling on the panel.
- [ ] Manually confirmed: a first visit (no stored theme) still renders the `paper` theme; changing the theme and reloading still respects the saved choice. No change expected in `ColorModeProvider`/ADR 0002 to achieve this — flag here if it turns out broken.

## Comments
