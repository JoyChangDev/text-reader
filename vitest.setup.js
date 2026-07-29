import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom doesn't implement scrollIntoView at all - stub it globally so components that
// call it (e.g. AudioPlayer's auto-scroll, see ticket 01) don't crash under test.
window.Element.prototype.scrollIntoView = vi.fn();

// jsdom doesn't implement matchMedia - next-themes' ThemeProvider (ticket 09) calls it
// unconditionally on mount to watch the OS color-scheme preference, even when the
// active theme isn't "system".
window.matchMedia = vi.fn().mockImplementation((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
});
