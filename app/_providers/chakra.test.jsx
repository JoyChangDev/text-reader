import { expect, test } from 'vitest';

import { system } from './chakra';

const LIGHT_SELECTOR = ':root &, .light &';
const DARK_SELECTOR = '.dark &, .dark .chakra-theme:not(.light) &';

function getModeLayers() {
  const layer = system.getTokenCss()['@layer tokens'];
  return { light: layer[LIGHT_SELECTOR], dark: layer[DARK_SELECTOR] };
}

test('resolves background/foreground/accent/danger tokens differently per color mode (ticket 09)', () => {
  const { light, dark } = getModeLayers();

  expect(light['--chakra-colors-background']).toBe('var(--chakra-colors-white)');
  expect(dark['--chakra-colors-background']).toBe('var(--chakra-colors-gray-950)');

  expect(light['--chakra-colors-foreground']).toBe('var(--chakra-colors-gray-900)');
  expect(dark['--chakra-colors-foreground']).toBe('var(--chakra-colors-gray-50)');

  expect(light['--chakra-colors-accent']).toBe('var(--chakra-colors-blue-600)');
  expect(dark['--chakra-colors-accent']).toBe('var(--chakra-colors-blue-300)');

  expect(light['--chakra-colors-danger']).toBe('var(--chakra-colors-red-600)');
  expect(dark['--chakra-colors-danger']).toBe('var(--chakra-colors-red-400)');
});

test('resolves active-sentence highlight tokens per color mode', () => {
  const { light, dark } = getModeLayers();

  expect(light['--chakra-colors-active-sentence-bg']).toBe('var(--chakra-colors-yellow-200)');
  expect(dark['--chakra-colors-active-sentence-bg']).toBe('var(--chakra-colors-yellow-600)');

  expect(light['--chakra-colors-active-sentence-fg']).toBe('var(--chakra-colors-black)');
  expect(dark['--chakra-colors-active-sentence-fg']).toBe('var(--chakra-colors-black)');
});
