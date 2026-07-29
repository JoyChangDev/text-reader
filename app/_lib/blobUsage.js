// The client-facing counterpart to blobCleanupService.js (parallel to
// bookLibrary.js/libraryService.js) - calls /api/blob-usage and /api/blob-cleanup so the
// capacity indicator and "clean up now" button don't talk to Blob directly. See
// .scratch/phase-1-6-listening-polish/issues/09-automatic-manual-blob-cleanup.md.
export async function getUsage() {
  const response = await fetch('/api/blob-usage');
  return response.json();
}

export async function cleanupBlobs() {
  const response = await fetch('/api/blob-cleanup', { method: 'POST' });
  return response.json();
}
