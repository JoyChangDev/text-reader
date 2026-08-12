# 01 — Project test infrastructure

**What to build:** Set up a test runner for the project so that all future work can carry real, fast unit tests, consistent with the existing Next.js/React/ESLint/Prettier tooling already in the repo.

**Blocked by:** None — can start immediately

**Status:** resolved — every acceptance criterion below is ticked and the work is in the code; only the Status line was never updated. Re-confirmed against the codebase on 2026-08-12.

- [x] A test runner (e.g. Vitest) is installed and configured to work with this Next.js/React project
- [x] A `test` script exists in package.json and is wired into the existing `check` script (or documented as a separate step) so tests run alongside lint/format checks
- [x] At least one trivial passing test exists to prove the runner works end-to-end
- [x] Running the test command locally exits successfully with no errors
