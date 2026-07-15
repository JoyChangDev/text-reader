# 07 — Local library with resume position

**What to build:** Uploaded books are saved as entries in the browser's local storage, each tracking its own resume chunk index. A library view lists all previously uploaded books. Opening a book from the library resumes playback at its saved position, and any already-heard chunks play instantly from cache rather than regenerating.

**Blocked by:** 06 — Upload + progressive playback UI

**Status:** ready-for-agent

- [ ] Uploading a `.txt` file adds a new entry to a persisted local library, without replacing any existing entries
- [ ] A library view lists all previously uploaded books
- [ ] Selecting a book from the library resumes playback at the chunk index it was last left at
- [ ] Reloading the app preserves the library and each book's resume position across the reload
- [ ] Replaying a chunk that was already generated earlier in the session plays instantly from cache, with no new `edge-tts` generation call
