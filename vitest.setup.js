import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom doesn't implement scrollIntoView at all - stub it globally so components that
// call it (e.g. AudioPlayer's auto-scroll, see ticket 01) don't crash under test.
window.Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});
