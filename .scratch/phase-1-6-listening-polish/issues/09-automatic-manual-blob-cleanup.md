# 09 — Automatic + manual Blob cleanup with capacity indicator

**What to build:** Prevent generated chunk audio from accumulating unbounded in Vercel
Blob: a daily automatic sweep of anything untouched for 7+ days, plus listener-facing
visibility into current usage and a manual trigger.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `blobCleanupService.js` implements `planCleanup({ blobs, now, retentionDays = 7 })`
      and `computeUsagePercent({ blobs, quotaBytes })` as pure functions, unit tested
      including boundary cases (exactly at the retention threshold, zero blobs, quota
      exactly reached)
- [ ] `planCleanup`'s results are scoped to chunk audio/metadata blobs only — never
      `library/*` or `pronunciation-reports/*`
- [ ] `GET /api/blob-usage` returns `{ usedBytes, quotaBytes, percent }`; `quotaBytes` is
      configurable via an environment variable
- [ ] `POST /api/blob-cleanup` deletes the blobs `planCleanup` identifies
- [ ] `vercel.json` (new file) declares a daily cron hitting `/api/blob-cleanup`
- [ ] The UI shows current capacity as a percentage, with a "clean up now" button that
      calls the same cleanup route on demand
- [ ] Route/service tests use a faked storage client — no real Blob/network calls

## Comments
