# Lesson 0002 callback: empty-input test, completed and merged

Joy closed out the outstanding Lesson 0002 exercise (flagged in `NOTES.md` on
2026-07-17) by writing `chunkText('')` → `[]` in
[app/_lib/chunkText.test.js](../app/_lib/chunkText.test.js), using `toEqual`
rather than `toBe` — correct recall of the array/object matcher rule from
[Lesson 0002](../lessons/0002-matchers-and-edge-cases.html) without a prompt.
Merged as commit `998df89` on 2026-07-18, ahead of the Lesson 0003 session
where it was folded in as a 2-minute warm-up.

**Evidence:** correct matcher chosen unprompted, work merged into the real
`chunkText.test.js` rather than left as a throwaway. Confirms the spaced
retrieval callback worked — no need to re-drill `toBe` vs `toEqual`.
