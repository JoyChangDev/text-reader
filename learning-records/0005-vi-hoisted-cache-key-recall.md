# Lesson 0007 exercise done: cache-key isolation test, no help needed

Joy completed Lesson 0007's hands-on task in
[app/api/audio-chunks/progressiveGeneration.test.js](../app/api/audio-chunks/progressiveGeneration.test.js):
added `'two different books do not share a cached chunk at the same index'`,
asserting `synthesizeCalls` reaches length `2` when two different `bookId`s
request the same `chunkIndex`/text — correctly using the shared `vi.hoisted()`
state from the earlier tests in the same file rather than declaring new mock
scaffolding. Suite passes (`4 passed`). Staged but not yet committed as of
this session — Joy's usual pattern (see [[0003-test-todo-callback-gotcha]],
[[0004-rtl-toBeEnabled-recall]]).

**Evidence:** correct reuse of existing `postChunks`/`postAudioChunk` helpers
and shared mock state without re-deriving them; correct assertion target
(`synthesizeCalls.length`, not a cache-hit return value) for proving no
generation was skipped; test suite green.

**Where this leaves the mission:** all mission checklist items are still
demonstrated except "async UI behavior (loading → success/error) via
`findBy`/`waitFor`" — see [[0004-rtl-toBeEnabled-recall]]. Ticket 05
(orchestration API) has since closed (`530d4ac`), but ticket 06
(upload/progressive playback UI) — the piece that would give this lesson real
async UI to anchor to — is still `ready-for-agent`, not yet built. Still a
genuine mission/codebase gap, not a teaching decision to defer silently.
