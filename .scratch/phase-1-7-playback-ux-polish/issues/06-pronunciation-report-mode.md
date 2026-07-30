# 06 — Pronunciation report mode

**What to build:** Reporting a pronunciation issue becomes an explicit mode entered from a bottom-bar toggle near settings. While active, Sentence-click seeking is disabled and arbitrary text selection is free to make; submitting opens a centered modal (with 「送出」centered and 「取消」right-aligned) instead of today's floating card. Cancelling or a successful submission exits report mode and restores normal Sentence-click seeking.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A report-mode toggle renders in the bottom bar near the settings disclosure and reflects current report-mode state.
- [ ] While report mode is active, Sentence-click seeking is disabled unconditionally (on top of, not instead of, the existing playing-state gate).
- [ ] Native text selection is unrestricted while report mode is active — any non-empty selection surfaces the report entry, not just click-targetable spans.
- [ ] Submitting a report opens as a centered modal (full-viewport dimming backdrop + centered card), pre-filled with the selected phrase and Book title, replacing the current absolutely-positioned floating card.
- [ ] The modal's action row places 「送出」centered and 「取消」aligned right.
- [ ] Cancelling (via the bottom-bar toggle or the modal's 「取消」) and a successful submission both exit report mode and restore normal Sentence-click seeking.
- [ ] Report mode has no effect on playback state itself (play/pause unaffected).
- [ ] No per-Sentence report shortcut is added — the bottom-bar toggle remains the only entry point.
- [ ] A new `PronunciationReportForm.test.jsx` covers: entering report mode and selecting arbitrary text opens the centered modal; Sentence-click is blocked while report mode is active regardless of playing state; the centered/right-aligned action layout; cancel and successful submission both exit report mode.

## Comments
