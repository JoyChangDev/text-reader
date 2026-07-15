# 06 — Upload + progressive playback UI

**What to build:** A page where the reader selects or drops a `.txt` file. The file's text is read client-side, sent to the orchestration API, and playback of the first chunk begins as soon as it's ready — while subsequent chunks generate in the background via a small look-ahead buffer, not the whole book at once. Basic play/pause controls are available.

**Blocked by:** 05 — Whole-book progressive generation orchestration

**Status:** ready-for-agent

- [ ] A reader can select or drop a `.txt` file from a page in the app
- [ ] Playback of the first chunk begins within a couple of seconds of upload, without waiting for the whole book to be processed
- [ ] While one chunk plays, a small number of upcoming chunks generate in the background so playback doesn't stall at chunk boundaries under normal conditions
- [ ] Play and pause controls work correctly during playback
- [ ] Chunks play back in the correct order with no gaps or overlaps between them
