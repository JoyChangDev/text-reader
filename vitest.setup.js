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

// jsdom implements neither half of the metadata-cue API the player is built on (phase
// 1.10 ticket 05): VTTCue doesn't exist at all, and addTextTrack is a declared-but-
// not-implemented stub that returns undefined. These stand in for both, faithfully
// enough that the hook under test uses the same calls it makes in a browser -
// addTextTrack('metadata'), track.mode, addCue, cues.getCueById, and a real cuechange
// event. What they deliberately do not do is work out activeCues from the clock: a test
// sets activeCues and dispatches cuechange itself, since the point under test is what
// the player does with a cue change, not when the media stack decides one happened.
globalThis.VTTCue = class VTTCue {
  constructor(startTime, endTime, text) {
    this.startTime = startTime;
    this.endTime = endTime;
    this.text = text;
    this.id = '';
  }
};

class FakeTextTrackCueList extends Array {
  getCueById(id) {
    return this.find((cue) => cue.id === id) ?? null;
  }
}

class FakeTextTrack extends EventTarget {
  constructor(kind) {
    super();
    this.kind = kind;
    this.mode = 'disabled';
    this.cues = new FakeTextTrackCueList();
    this.activeCues = [];
  }

  addCue(cue) {
    this.cues.push(cue);
  }

  removeCue(cue) {
    const index = this.cues.indexOf(cue);
    if (index !== -1) this.cues.splice(index, 1);
  }
}

window.HTMLMediaElement.prototype.addTextTrack = function addTextTrack(kind) {
  // jsdom's own `textTracks` is a real (permanently empty) TextTrackList with no way to
  // append, so the element gets its own array-shaped one instead - tests reach the track
  // the same way page code would, via `audioElement.textTracks[0]`.
  if (!Array.isArray(this.textTracks)) {
    Object.defineProperty(this, 'textTracks', { value: [], configurable: true });
  }
  const track = new FakeTextTrack(kind);
  this.textTracks.push(track);
  return track;
};

afterEach(() => {
  cleanup();
});
