# Lesson 0006 exercise: `toBeEnabled` assertion, applied unprompted

Joy completed Lesson 0006's hands-on task in
[app/page.test.jsx](../app/page.test.jsx): stored the `getAllByRole('button', ...)`
result in a variable and asserted `toBeEnabled()` on each button via `.forEach`,
exactly the pattern the lesson described — no help needed. Suite passes
(`1 passed`).

This confirms independent command of `getByRole`/`getAllByRole` plus a
`jest-dom` matcher beyond `toHaveLength`, and correctly distinguishing
"element exists" from "element is interactive" — the core point of the
lesson. Not yet committed as of this session; Joy generally commits their own
exercise work once confirmed (see [[0002-chunktext-empty-input-recall]],
[[0003-test-todo-callback-gotcha]] for the pattern).

**Evidence:** correct variable-and-forEach structure written unprompted,
correct matcher choice (`toBeEnabled` not `toBeInTheDocument`), test suite
green.

**Where this leaves the mission:** all mission checklist items are now
demonstrated except "async UI behavior (loading → success/error) via
`findBy`/`waitFor`" — the last untaught skill from [[../MISSION|MISSION.md]].
No real async UI exists in the codebase yet to anchor that lesson to
(ticket 06, the upload/playback UI, is still `ready-for-agent` and blocked by
ticket 05); this is a genuine gap between mission and current codebase state,
not a teaching decision to make silently.
