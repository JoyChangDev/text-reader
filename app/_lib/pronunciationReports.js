// The client-facing counterpart to pronunciationReportService.js (parallel to
// bookLibrary.js/libraryService.js) - calls /api/pronunciation-reports so the report
// form doesn't talk to storage directly. See
// .scratch/phase-1-6-listening-polish/issues/10-pronunciation-issue-reporting.md.
export async function submitReport({ bookTitle, phrase, description }) {
  const response = await fetch('/api/pronunciation-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTitle, phrase, description }),
  });

  if (!response.ok) {
    throw new Error('Submitting the pronunciation report failed');
  }

  return response.json();
}
