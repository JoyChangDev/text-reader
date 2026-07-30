'use client';

import { useEffect } from 'react';

import Home from '../page';
import { installPreviewFetchMock } from './previewFetchMock';

// Dev-only screen for eyeballing library/player UI states without a real backend - see
// previewFetchMock.js. Renders the real Home tree unmodified (BookUploader, BookLibrary,
// AudioPlayer, PlayerBar, ThemeToggle...) against static fixture data instead of a live
// network, so every screen behaves exactly as it does in production. Not available once
// deployed - dev tooling only.
//
// Installed here, at module scope, rather than inside the component (in an effect or
// during render): effects fire child-first on mount, so installing it in this
// component's own effect would let Home's grandchild BookLibrary fire its own fetch
// effect first, against the real, unmocked fetch - and React's compiler-oriented lint
// rules (react-hooks/refs, react-hooks/set-state-in-effect) rule out the usual
// during-render workarounds (ref/state mutation in the render body) as impure. Module
// evaluation runs once, before this component is ever called, which sidesteps both
// problems. The trade-off: it only (re)installs on a fresh page load - client-side
// back/forward into this route without a full reload won't re-arm the mock after
// unmount's cleanup restores the real fetch. Reload the page if that happens.
const restoreFetch = typeof window === 'undefined' ? null : installPreviewFetchMock();

export default function DevPreviewPage() {
  useEffect(() => () => restoreFetch?.(), []);

  if (process.env.NODE_ENV === 'production') {
    return <p>Not available in production.</p>;
  }

  return <Home />;
}
