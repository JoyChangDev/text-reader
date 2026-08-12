# 10 — Pronunciation issue reporting

**What to build:** Let the listener flag a mispronounced word or phrase for later manual
review — book title, the selected phrase, and an optional description, with a
server-assigned timestamp.

**Blocked by:** 01

**Status:** resolved

- [x] `pronunciationReportService.js` implements `submitReport({ bookTitle, phrase,
description })`, storing `{ bookTitle, phrase, description, reportedAt }` (a
      server-generated timestamp, not user-supplied) via the shared storage seam
- [x] `POST /api/pronunciation-reports` calls `submitReport`
- [x] Selecting a phrase in the transcript (native text selection) surfaces a "report
      pronunciation issue" affordance, pre-filled with the selected phrase and the current
      book's title, plus an optional description field
- [x] Submitting the form calls the API and gives the listener visible confirmation
- [x] No automatic pronunciation correction or SSML override is implemented — reports are
      stored for manual review only
- [x] Test coverage for the form component and for the service/route against a faked
      storage client

## Comments
