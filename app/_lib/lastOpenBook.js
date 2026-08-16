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

// Module scope, so this resets exactly when the document does - which is the distinction
// `/` needs and cannot get any other way.
let readerOpenedInThisDocument = false;

// The pointer answers "restore the Listener into their Book", but only for the one exit that
// runs no code at all: a killed process. A back gesture is a deliberate exit, and `/` was
// redirecting straight back into the reader for both, so back could never reach the Library.
//
// At the moment `/` mounts, the two cases look identical - a mount that finds a pointer. What
// separates them is the document: a kill starts a new one, a back gesture stays in the one
// already running. The reader marks itself here on mount, so `/` can ask whether it is being
// reached for the first time in this document (restore) or returned to (respect it).
//
// A listener on the reader's own unmount cannot do this job. popstate runs the router's
// handler first, which re-renders and unmounts the reader - taking its listener with it -
// before the listener would have fired. Verified in a browser, not assumed.
export function markReaderOpened() {
  readerOpenedInThisDocument = true;
}

export function hasReaderOpenedInThisDocument() {
  return readerOpenedInThisDocument;
}

// Nothing in the app calls this: a real document gets a fresh module, so the flag resets by
// itself at exactly the moment it should. A test file gets one jsdom document for all of its
// tests, so "the next launch" has to be asked for explicitly - alongside the localStorage.clear()
// the same beforeEach blocks already do, and for the same reason.
export function resetReaderOpened() {
  readerOpenedInThisDocument = false;
}
