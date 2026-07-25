# Lesson 0008 exercise done: full-file beforeEach refactor, no help needed

Joy completed Lesson 0008's hands-on task in
[app/_lib/audioGenerationService.test.js](../app/_lib/audioGenerationService.test.js):
added `beforeEach` importing correctly, hoisted `storageClient`/`ttsClient` to
`let` declarations at `describe` scope, and rebuilt them fresh in `beforeEach`
— then went further than the two worked examples in the lesson and applied
the same pattern to the two failure-path tests too, exactly as the exercise
asked. Every test now only sets the `.mockResolvedValue`/`.mockRejectedValue`
call it individually needs; no duplicated object literals remain. Suite
passes (`4 passed`). Not yet committed as of this session — Joy's usual
pattern (see [[0005-vi-hoisted-cache-key-recall]]).

**Evidence:** correctly distinguished which four tests needed the refactor
(all of them, not just the two demonstrated in the lesson); no regression in
assertions; reused the shared `storageClient`/`ttsClient` names instead of
reintroducing local shadows; test suite green.

**Where this leaves the mission:** all mission checklist items are still
demonstrated except "async UI behavior (loading → success/error) via
`findBy`/`waitFor`" — see [[0004-rtl-toBeEnabled-recall]]. Ticket 06
(upload/playback UI) is still `ready-for-agent`, unchanged since last
session — still the blocker, not a teaching decision to revisit yet.
