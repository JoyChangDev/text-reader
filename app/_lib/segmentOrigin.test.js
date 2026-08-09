import { afterEach, describe, expect, test, vi } from 'vitest';

import { requireSegmentOrigin } from './segmentOrigin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireSegmentOrigin', () => {
  test('reads the origin from the environment', () => {
    vi.stubEnv('SEGMENT_ORIGIN', 'https://leia.text-reader.workers.dev/');

    expect(requireSegmentOrigin()).toBe('https://leia.text-reader.workers.dev/');
  });

  test('prefers an explicitly configured origin over the environment', () => {
    vi.stubEnv('SEGMENT_ORIGIN', 'https://leia.text-reader.workers.dev/');

    expect(requireSegmentOrigin('https://other.workers.dev/')).toBe('https://other.workers.dev/');
  });

  // Loud rather than absent, because the alternative is a playlist of URLs that 404 against a
  // store that is working — the most misleading failure this configuration has available.
  test('throws naming the variable when nothing is configured', () => {
    vi.stubEnv('SEGMENT_ORIGIN', '');

    expect(() => requireSegmentOrigin()).toThrow(/SEGMENT_ORIGIN/);
  });

  // deriveSegmentUrl concatenates and audioPathname has no leading slash, so a slashless
  // origin gives `…workers.devbook-1/0/voice.mp3`. Repairing it here instead would let a
  // caller that skipped the repair build a different URL for the same object.
  test('refuses an origin with no trailing slash rather than repairing it', () => {
    expect(() => requireSegmentOrigin('https://leia.text-reader.workers.dev')).toThrow(
      /SEGMENT_ORIGIN must end with a slash/,
    );
  });
});
