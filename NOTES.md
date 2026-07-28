# Notes

- Learns in scattered downtime between working on `text-reader` itself, not on a fixed schedule - keep every lesson short and self-contained (single sitting, single win).
- Complete testing beginner (never written any test, in any language) as of 2026-07-15 - do not assume prior exposure to assertions, mocking, or test runners in general.
- Already fluent in React/JS/Next.js from building this project - never needs React fundamentals re-taught.
- Wants dual value from every lesson where possible: (1) transferable testing skill, (2) real progress on `text-reader`'s actual test suite. Prefer exercises that produce code the project will actually keep, not throwaway toy examples, when a real one fits the lesson's scope.
- Will sometimes name the exact ticket/topic to teach next (e.g. "/teach ticket 04") rather than leaving it to inferred ZPD - when given, honor it directly instead of picking a different next-topic.
- 2026-07-18: confirmed both outstanding exercises done and merged - Lesson 0002's empty-array `chunkText` test (commit `998df89`) and Lesson 0003's cache-miss `audioGenerationService` test (on top of `b6c8b61`). See [[0002-chunktext-empty-input-recall]] and [[0003-test-todo-callback-gotcha]].
- 2026-07-23: Lesson 0006 exercise (`toBeEnabled` on both Home buttons) done and green, not yet committed. Prefers real code over toy examples for the async findBy/waitFor lesson (last untaught mission item) - explicitly chose to wait until ticket 06 (upload/playback UI) exists rather than teach it against a throwaway example now. Don't propose that lesson again until ticket 06 lands.
- 2026-07-25: Lesson 0007 exercise (two-book cache-key isolation test in `progressiveGeneration.test.js`) done and green; committed as `90eb069`. See [[0005-vi-hoisted-cache-key-recall]]. Ticket 05 closed (`530d4ac`) since last session but ticket 06 (upload/playback UI) is still `ready-for-agent` - the async findBy/waitFor lesson is still blocked, same gap as 2026-07-23.
- 2026-07-25 (same session): taught Lesson 0008 (`beforeEach` shared setup) as a bridge lesson while waiting on ticket 06 - Joy explicitly chose "bridge lesson now" over waiting/reviewing when asked. Exercise (refactor all 4 `audioGenerationService.test.js` tests) done and green, not yet committed. See [[0006-beforeeach-shared-setup-recall]]. Good bridge-lesson pattern to reuse next time ticket 06 is still blocked: find real duplication/friction in existing passing tests rather than inventing a toy example.
- 2026-07-28: Lesson 0008's exercise is now committed (`56f9383`, confirmed via `git log`, no separate confirmation from Joy needed this time). Ticket 06 (upload/playback UI) landed since last session (`3f95632`, plus tickets 07/08/09 and a deploy) - this unblocked the last untaught mission item: async `findBy`/`waitFor`. Notably the feature work already left real `findBy`/`waitFor` code in `BookUploader.test.jsx`/`AudioPlayer.test.jsx` that Joy hasn't been taught yet (written by agent feature work, not by Joy). Taught Lesson 0009 grounded in that existing code; exercise adds a new test for a real untested gap (`BookUploader`'s error message should clear on a successful re-upload) rather than a toy example. Once this exercise is confirmed done, every MISSION.md checklist item will have been demonstrated - worth flagging to Joy that the mission may be near "complete" and could warrant a check-in on what's next (new mission scope, or shift to maintenance-mode/spaced-review lessons).

---

# 筆記

- 學習時間穿插在開發 `text-reader` 本身的零碎空檔中，沒有固定時程。每一課都要保持短小、獨立，可以在單次學習中完成，並帶來一個明確收穫。
- 截至 2026-07-15，使用者是完整的測試初學者，從未用任何語言寫過測試。不要預設使用者已接觸過 assertions、mocking，或任何測試執行器。
- 使用者已透過開發這個專案熟悉 React/JS/Next.js，不需要重新教授 React 基礎。
- 每一課盡可能同時提供兩種價值：(1) 可遷移的測試技能，(2) 實際推進 `text-reader` 的測試套件。只要真實專案內容適合該課範圍，就優先設計會留下來的練習程式碼，而不是一次性的玩具範例。
- 使用者有時會指定下一個要教的確切 ticket 或主題，例如「/teach ticket 04」，而不是讓系統推測最近發展區。若使用者有明確指定，直接遵照指定內容，不要改選其他下一個主題。
- 2026-07-18：已確認兩個未完成練習都完成並合併：Lesson 0002 的空陣列 `chunkText` 測試（commit `998df89`），以及 Lesson 0003 的 cache-miss `audioGenerationService` 測試（基於 `b6c8b61` 之上）。參見 [[0002-chunktext-empty-input-recall]] 與 [[0003-test-todo-callback-gotcha]]。
