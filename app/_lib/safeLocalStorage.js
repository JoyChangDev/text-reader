// localStorage can be unavailable (private browsing, quota, disabled storage) - these
// wrappers fail silently in that case, so callers (lastOpenBook.js,
// backgroundDiagnostics.js) don't each need their own try/catch for the same failure
// mode. Losing a write/read here means losing a convenience feature (auto-restore, a
// diagnostic log entry), never a functional break worth surfacing to the Listener.
export function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See file comment.
  }
}

export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // See file comment.
  }
}
