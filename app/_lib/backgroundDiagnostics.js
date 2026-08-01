import { safeGetItem, safeRemoveItem, safeSetItem } from './safeLocalStorage';

const STORAGE_KEY = 'backgroundDiagnosticsLog';
const MAX_ENTRIES = 50;

// TEMPORARY scaffolding for Phase 1.9 ticket 04 (diagnosing why Phase 1.8's background
// reconciliation still isn't preventing the reported stop/desync symptoms on real iOS
// Safari). Ordinary console logging is useless for the case most worth debugging - the
// process getting killed takes the console with it - so this persists a capped ring
// buffer to localStorage instead, readable on the very next launch without a Mac or
// remote debugger. Delete this file and its call sites (useBookPlayer.js,
// useMediaSession.js, BackgroundDiagnosticsPanel.jsx) once ticket 04 ships - see
// specs/phase-1-9-reader-route-restructure.md.
export function logDiagnosticEvent(type, detail = {}) {
  const log = getDiagnosticLog();
  log.push({ type, detail, timestamp: Date.now() });
  while (log.length > MAX_ENTRIES) log.shift();
  safeSetItem(STORAGE_KEY, JSON.stringify(log));
}

export function getDiagnosticLog() {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearDiagnosticLog() {
  safeRemoveItem(STORAGE_KEY);
}

// Plain-text, chronological (oldest first, unlike the on-screen list which shows
// newest first) rendering of the log - meant to be copied off the phone's cramped
// screen and pasted somewhere it can actually be read in full (see
// BackgroundDiagnosticsPanel.jsx's copy button).
export function formatDiagnosticLog(entries) {
  return entries
    .map(
      (entry) =>
        `${new Date(entry.timestamp).toISOString()} ${entry.type} ${JSON.stringify(entry.detail)}`,
    )
    .join('\n');
}
