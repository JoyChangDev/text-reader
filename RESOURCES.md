# Frontend Testing (Vitest + Testing Library) Resources

## Knowledge

- [Vitest — Getting Started Guide](https://vitest.dev/guide/)
  Official docs for the test runner already installed in this project. Use for: `describe`/`test`/`expect` API, `vi.fn()`/`vi.mock()` for fakes, watch mode, config reference.
- [Testing Library — React Testing Library docs](https://testing-library.com/docs/react-testing-library/intro/)
  Official docs, source of the library's guiding principle: "the more your tests resemble the way your software is used, the more confidence they can give you." Use for: `render`, `screen`, the query API.
- [Testing Library — About Queries (priority list)](https://testing-library.com/docs/queries/about/#priority)
  The official order of preference for queries (`getByRole` first, `getByTestId` last resort). Use for: deciding which query to reach for when writing any RTL test.
- [Kent C. Dodds — "Common Mistakes with React Testing Library"](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
  Written by Testing Library's creator. Use for: avoiding beginner traps (calling the render result `wrapper`, manual `cleanup`, over-using `act`, reaching for `container.querySelector`).
- [Kent C. Dodds — "Testing Implementation Details"](https://kentcdodds.com/blog/testing-implementation-details)
  Explains _why_ RTL avoids testing internal component state/props. Use for: grounding the spec's instruction to assert on "external, observable behavior," not implementation shape.
- [Testing Library — Async utilities (`findBy`, `waitFor`)](https://testing-library.com/docs/dom-testing-library/api-async/)
  Official async query docs. Use for: testing loading/error states in the audiobook player without flaky arbitrary timeouts.
- [Vitest — `vi.mock()` API](https://vitest.dev/api/vi.html#vi-mock)
  Official docs for replacing an entire module (vs. dependency-injection fakes). Use for: testing code that imports its dependency directly, like the `audio-chunks` API route.
- [Vitest — `expect().rejects`](https://vitest.dev/api/expect.html#rejects)
  Official docs for unwrapping a rejected Promise so a matcher like `toThrow` can assert on it. Use for: testing that an `async` function's failure path propagates correctly, as in `audioGenerationService`'s generation-failure test.
- [Vitest — `vi.hoisted()`](https://vitest.dev/api/vi.html#vi-hoisted)
  Official docs for the API that lets a `vi.mock()` factory safely reference a shared variable declared elsewhere in the file, by hoisting that declaration alongside `vi.mock()` itself. Use for: mocking two collaborating modules (e.g. `@vercel/blob` and `edge-tts-universal`) that need to read/write the same in-memory fake state, as in `progressiveGeneration.test.js`.

## Wisdom (Communities)

- [Testing Library Discord](https://discord.com/invite/testing-library)
  ~6k members, official community for all testing-library projects. Use for: query-selection questions, "how do I test X" troubleshooting.
- [Vitest GitHub Discussions](https://github.com/vitest-dev/vitest/discussions)
  Official Q&A space for the test runner itself. Use for: config/runner-level questions (mocking modules, environment setup) once past the basics.

## Gaps

- No community/resource yet specifically on testing Next.js Route Handlers (beyond calling the exported `POST`/`GET` function directly with a hand-built request object, as `route.test.js` does) — revisit if a route needs something the current approach can't cover (e.g. streaming responses, middleware).

---

# 前端測試（Vitest + Testing Library）資源（中文版）

## 知識類

- [Vitest — 官方入門指南](https://vitest.dev/guide/)
  這個專案已經安裝的測試框架的官方文件。用途：`describe`/`test`/`expect` API、用 `vi.fn()`/`vi.mock()` 做假物件、監看模式、設定檔參考。
- [Testing Library — React Testing Library 文件](https://testing-library.com/docs/react-testing-library/intro/)
  官方文件，也是這個函式庫核心理念的出處：「你的測試越像使用者實際使用軟體的方式，就能給你越多信心。」用途：`render`、`screen`、查詢 API。
- [Testing Library — 查詢方式說明（含優先順序）](https://testing-library.com/docs/queries/about/#priority)
  官方訂出的查詢方式優先順序（`getByRole` 最優先，`getByTestId` 是最後手段）。用途：寫任何 RTL 測試時，決定該用哪種查詢方式。
- [Kent C. Dodds — "Common Mistakes with React Testing Library"](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
  Testing Library 作者本人寫的文章。用途：避開新手常犯的錯（把 render 回傳值取名叫 `wrapper`、手動呼叫 `cleanup`、濫用 `act`、動用 `container.querySelector`）。
- [Kent C. Dodds — "Testing Implementation Details"](https://kentcdodds.com/blog/testing-implementation-details)
  解釋為什麼 RTL 刻意避免測試元件內部的 state/props。用途：理解 spec 裡「斷言在外部可觀察的行為上」這個決策背後的原因。
- [Testing Library — 非同步工具（`findBy`、`waitFor`）](https://testing-library.com/docs/dom-testing-library/api-async/)
  官方的非同步查詢文件。用途：測試有聲書播放器的讀取中/錯誤狀態，不用寫容易 flaky 的固定等待時間。
- [Vitest — `vi.mock()` API](https://vitest.dev/api/vi.html#vi-mock)
  官方文件，說明如何換掉整個模組（相對於依賴注入的假物件）。用途：測試直接 import 依賴的程式碼，例如 `audio-chunks` 這個 API route。
- [Vitest — `expect().rejects`](https://vitest.dev/api/expect.html#rejects)
  官方文件，說明如何「打開」一個 reject 的 Promise，讓 `toThrow` 這類 matcher 可以斷言它。用途：測試 `async` 函式的失敗路徑有沒有正確傳出去，例如 `audioGenerationService` 的生成失敗測試。
- [Vitest — `vi.hoisted()`](https://vitest.dev/api/vi.html#vi-hoisted)
  官方文件，說明如何讓 `vi.mock()` 的 factory 安全讀寫檔案裡其他地方宣告的共用變數——把那個宣告跟 `vi.mock()` 一起提升。用途：同時 mock 兩個需要共用同一份假資料的模組（例如 `@vercel/blob` 和 `edge-tts-universal`），如 `progressiveGeneration.test.js` 所做。

## 智慧類（社群）

- [Testing Library Discord](https://discord.com/invite/testing-library)
  約 6000 名成員，所有 testing-library 系列專案的官方社群。用途：查詢方式怎麼選、「這個情境該怎麼測」的疑難排解。
- [Vitest GitHub Discussions](https://github.com/vitest-dev/vitest/discussions)
  測試框架本身的官方問答區。用途：過了基礎階段後，設定/框架層級的問題（mock 模組、環境設定）。

## 缺口

- 目前還沒有專門講「測試 Next.js Route Handler」的社群/資源（現行做法是直接呼叫匯出的 `POST`/`GET` 函式，傳一個手刻的 request 物件，如 `route.test.js` 所做）—— 如果之後遇到現行做法處理不了的情境（例如串流回應、middleware）再補。
