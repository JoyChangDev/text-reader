import { describe, expect, test } from 'vitest';

import manifest from './manifest';

describe('manifest', () => {
  test('returns the expected shape', () => {
    expect(manifest()).toEqual({
      name: 'text-reader',
      short_name: 'text-reader',
      description: expect.any(String),
      start_url: '/',
      display: 'standalone',
      background_color: expect.any(String),
      theme_color: expect.any(String),
      icons: expect.arrayContaining([
        expect.objectContaining({ src: '/icon', sizes: '32x32', type: 'image/png' }),
        expect.objectContaining({ src: '/apple-icon', sizes: '180x180', type: 'image/png' }),
      ]),
    });
  });
});
