import { expect, test } from 'vitest';

import { system } from './chakra';

test('wires custom background/foreground/accent semantic tokens to Chakra defaults', () => {
  const tokenCss = JSON.stringify(system.getTokenCss());

  expect(tokenCss).toContain('"--chakra-colors-background":"var(--chakra-colors-bg)"');
  expect(tokenCss).toContain('"--chakra-colors-foreground":"var(--chakra-colors-fg)"');
  expect(tokenCss).toContain('"--chakra-colors-accent"');
});

test('wires active-sentence highlight semantic tokens', () => {
  const tokenCss = JSON.stringify(system.getTokenCss());

  expect(tokenCss).toContain('"--chakra-colors-active-sentence-bg"');
  expect(tokenCss).toContain('"--chakra-colors-active-sentence-fg"');
});
