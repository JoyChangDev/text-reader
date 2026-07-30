import { createBlobStorageClient } from './blobStorageClient';

const REPORTS_KEY = 'pronunciation-reports/index';

const defaultClients = { storageClient: createBlobStorageClient() };

// Listener-flagged mispronunciations, stored for manual review only - no automatic
// correction or SSML override happens from this (see
// .scratch/phase-1-6-listening-polish/issues/10-pronunciation-issue-reporting.md).
// Reports accumulate in a single index blob, the same shape libraryService.js's
// index/chunks split establishes for the shared storage seam.
export async function submitReport(
  { bookTitle, phrase, description },
  { storageClient } = defaultClients,
) {
  const reports = (await storageClient.get(REPORTS_KEY)) ?? [];
  const report = {
    bookTitle,
    phrase,
    description: description ?? null,
    reportedAt: new Date().toISOString(),
  };

  await storageClient.putJson(REPORTS_KEY, [...reports, report]);

  return report;
}
