# Mission: Frontend Testing (Vitest + Testing Library)

## Why

Joy is building `text-reader`, a Next.js Traditional-Chinese audiobook web app (see [specs/phase-1-audiobook-reader.md](specs/phase-1-audiobook-reader.md)), and just wired up Vitest as the project's first test runner. Joy has never written a test before and wants two things at once: real, working tests for this project's upcoming pieces (chunking, the Audio Generation Service seam, library/progress persistence, UI components), and a transferable frontend-testing skill that carries to future projects — not a one-off trick learned only in this codebase.

## Success looks like

- Can explain what a unit test asserts and write one from scratch using Vitest's `describe`/`test`/`expect`, without copying a template.
- Can write a React Testing Library test that queries by role/text the way a user would (per the [spec's testing decisions](specs/phase-1-audiobook-reader.md#testing-decisions)), not by internal component details.
- Can substitute a fake/mock at a module boundary (e.g. the `edge-tts` client or storage client) so a test never makes a real network call — the exact pattern the Audio Generation Service seam requires.
- Can test async UI behavior (loading → success/error states) using `findBy`/`waitFor` rather than arbitrary timeouts.
- Has actually written and merged tests for at least one real piece of `text-reader` (e.g. the chunking function, or the library persistence layer) as they get built.

## Constraints

- Learns in scattered dev downtime between other work on this project — no fixed schedule. Lessons must be short, self-contained, and immediately usable (open lesson, learn one thing, apply it to the code right in front of them).
- Complete beginner to testing of any kind — start from fundamentals (what a test/assertion is, arrange-act-assert) before Testing-Library-specific patterns.
- Already comfortable with React/JS (has a working Next.js + Chakra UI app), so no need to re-teach React basics.

## Out of scope

- End-to-end/browser automation tools (Playwright, Cypress) — mission is unit/component testing with Vitest + Testing Library only.
- Test runner configuration/internals — `vitest.config.js` is already set up; not a teaching target unless something breaks.
- CI pipeline setup for running tests on push — not requested, revisit if it comes up.

---

# 任務目標：前端測試（Vitest + Testing Library）（中文版）

## 為什麼

Joy 正在開發 `text-reader`，一個 Next.js 打造的繁體中文有聲書網頁應用（詳見 [specs/phase-1-audiobook-reader.md](specs/phase-1-audiobook-reader.md)），最近才把 Vitest 設定成專案的第一個測試框架。Joy 從來沒寫過測試，同時想要兩件事：一是為專案接下來要做的功能（文字分段 chunking、Audio Generation Service 的介接層、書籍/進度的本地儲存、UI 元件）寫出真正能用的測試；二是培養可以帶到未來其他專案的前端測試能力，而不是只在這個 codebase 裡管用的一次性技巧。

## 成功的樣子

- 能說明一個單元測試在斷言什麼，並且能用 Vitest 的 `describe`/`test`/`expect` 從零寫出一個測試，不用照抄範本。
- 能寫出用 role/文字內容查詢元素的 React Testing Library 測試，就像使用者實際操作畫面那樣（依照 [spec 的 Testing Decisions 段落](specs/phase-1-audiobook-reader.md#testing-decisions)），而不是依賴元件內部細節。
- 能在模組邊界替換掉假物件/mock（例如 `edge-tts` client 或儲存空間 client），讓測試永遠不會真的打網路請求 —— 這正是 Audio Generation Service 這個介接層要求的模式。
- 能用 `findBy`/`waitFor` 測試非同步的 UI 行為（讀取中 → 成功/失敗狀態），而不是亂猜一個等待時間。
- 已經為 `text-reader` 至少一個真實功能（例如 chunking 函式，或書籍進度儲存層）寫過測試並且合併進專案。

## 限制

- 利用開發空檔零散學習，沒有固定排程 —— 每堂課都必須短小、自成一體、學完馬上就能套用在眼前的程式碼上。
- 完全沒有任何測試經驗 —— 要從基礎開始（什麼是測試/斷言、Arrange-Act-Assert），再進到 Testing Library 特有的寫法。
- 對 React/JS 已經很熟（已經做出一個能跑的 Next.js + Chakra UI app），不需要重新教 React 基礎。

## 不在範圍內

- 端對端/瀏覽器自動化工具（Playwright、Cypress）—— 目標是用 Vitest + Testing Library 做單元/元件測試，不含 E2E。
- 測試框架本身的設定/內部運作 —— `vitest.config.js` 已經設定好了，除非出問題否則不會特別教。
- 把測試接進 CI（push 就自動跑測試）—— 目前沒人要求，之後有需要再說。
