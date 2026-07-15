# 01 — Project test infrastructure

**What to build:** Set up a test runner for the project so that all future work can carry real, fast unit tests, consistent with the existing Next.js/React/ESLint/Prettier tooling already in the repo.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A test runner (e.g. Vitest) is installed and configured to work with this Next.js/React project
- [ ] A `test` script exists in package.json and is wired into the existing `check` script (or documented as a separate step) so tests run alongside lint/format checks
- [ ] At least one trivial passing test exists to prove the runner works end-to-end
- [ ] Running the test command locally exits successfully with no errors
