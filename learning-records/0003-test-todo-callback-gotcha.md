# Lesson 0003 exercise completed; `test.todo` callback gotcha surfaced and self-fixed

Joy completed Lesson 0003's hands-on task in
[app/_lib/audioGenerationService.test.js](../app/_lib/audioGenerationService.test.js):
wrote a correct cache-miss test with `vi.fn().mockResolvedValue(...)` fakes for
`storageClient`/`ttsClient` and all three assertions (`toEqual` on the result,
`toHaveBeenCalledWith` on both fakes) — the dependency-injection mocking
pattern from the lesson, applied independently.

One real gotcha surfaced: Joy wrote the test body inside
`test.todo('...', async () => {...})` instead of `test('...', async () => {...})`.
Vitest's `test.todo` silently ignores any callback passed to it — the test is
always registered as "todo" and the body never runs, whether or not one is
supplied. `npm test` reported `1 passed | 1 todo` with no failure, which is
what made this confusing to debug from the output alone. After the explanation,
Joy identified and removed `.todo` unaided, and the suite went to `2 passed`.

**Why this matters going forward:** this is a silent-no-op failure mode, not a
red test — worth flagging any time a lesson exercise's assertions "don't seem
to run" but nothing turns red. Documented in
[reference/vitest-basics.html](../reference/vitest-basics.html) so it doesn't
need re-explaining.

**Evidence:** correct AAA/mocking structure written unprompted; gotcha
diagnosed from a one-line explanation and fixed without further help; commit
follows `b6c8b61` on the `feature/audio-generation` branch.
