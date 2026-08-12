# 07 — Traditional Chinese translation of visible UI & errors

**What to build:** Every visible UI string and user-facing error message across the reader — including `aria-label`s — reads in Traditional Chinese. Internal identifiers (`data-testid`, code, comments) are untouched.

**Blocked by:** 01, 02, 03, 05, 06 — sequenced last so no string is translated and then reworked or deleted by a later structural change

**Status:** resolved — built and in the code, confirmed against the codebase on 2026-08-12. The boxes below were never ticked: that is unfilled paperwork, not open work. They have not been audited line by line, so trust the code over the checkboxes here.

- [ ] `AudioPlayer.jsx` ("Back to library") is translated.
- [ ] `PlayerBar.jsx` (audio-generation-failed alert, report-mode toggle label) is translated.
- [ ] `PlayerSettingsSheet.jsx` ("Settings", "Narration voice", "Playback speed", "Appearance", "Close settings") is translated.
- [ ] `PronunciationReportForm.jsx` (all labels, button text, success and error messages) is translated.
- [ ] `BookLibrary.jsx` ("Your library", "Delete …", "Completed") is translated.
- [ ] Any other remaining visible English copy in the reader (upload screen, `ThemeToggle`, `VoicePreview`, etc.) is translated.
- [ ] User-facing `aria-label`s across the above components are translated.
- [ ] `data-testid` values, variable/function names, and code comments are left unchanged.
- [ ] Existing component tests that assert on now-translated copy are updated to match the Traditional Chinese strings.

## Comments
