import { safeGetItem, safeRemoveItem, safeSetItem } from './safeLocalStorage';

const STORAGE_KEY = 'lastOpenBook';

// The last book the Listener had open, persisted so a killed/reloaded process (see
// specs/phase-1-9-reader-route-restructure.md) can redirect back into the reader instead
// of stranding the Listener on the library screen with no explanation.
export function setLastOpenBook(bookId) {
  safeSetItem(STORAGE_KEY, JSON.stringify({ bookId }));
}

export function getLastOpenBook() {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw)?.bookId ?? null;
  } catch {
    return null;
  }
}

export function clearLastOpenBook() {
  safeRemoveItem(STORAGE_KEY);
}
