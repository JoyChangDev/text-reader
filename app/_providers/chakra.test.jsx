import { expect, test } from 'vitest';

import { system } from './chakra';

const PAPER_SELECTOR = '.paper &';
const NIGHT_SELECTOR = '.night &';
const SOFT_SELECTOR = '.soft &';

function getPresetLayers() {
  const layer = system.getTokenCss()['@layer tokens'];
  return { paper: layer[PAPER_SELECTOR], night: layer[NIGHT_SELECTOR], soft: layer[SOFT_SELECTOR] };
}

test('resolves background/foreground/accent/danger tokens differently per preset (ADR 0002)', () => {
  const { paper, night, soft } = getPresetLayers();

  expect(paper['--chakra-colors-background']).toBe('#F1EFE8');
  expect(night['--chakra-colors-background']).toBe('#0B0C0E');
  expect(soft['--chakra-colors-background']).toBe('#EFF3F6');

  expect(paper['--chakra-colors-foreground']).toBe('#262320');
  expect(night['--chakra-colors-foreground']).toBe('#ECE7DC');
  expect(soft['--chakra-colors-foreground']).toBe('#2E3944');

  expect(paper['--chakra-colors-accent']).toBe('#7A5313');
  expect(night['--chakra-colors-accent']).toBe('#E8A961');
  expect(soft['--chakra-colors-accent']).toBe('#7C86D9');

  expect(paper['--chakra-colors-danger']).toBe('#A23E2E');
  expect(night['--chakra-colors-danger']).toBe('#E2725A');
  expect(soft['--chakra-colors-danger']).toBe('#D97078');
});

test('resolves active-sentence highlight tokens per preset', () => {
  const { paper, night, soft } = getPresetLayers();

  expect(paper['--chakra-colors-active-sentence-bg']).toBe('#F3DFA0');
  expect(night['--chakra-colors-active-sentence-bg']).toBe('rgba(232, 169, 97, 0.22)');
  expect(soft['--chakra-colors-active-sentence-bg']).toBe('#D8E6F5');

  expect(paper['--chakra-colors-active-sentence-fg']).toBe('#2A2013');
  expect(night['--chakra-colors-active-sentence-fg']).toBe('#F3C888');
  expect(soft['--chakra-colors-active-sentence-fg']).toBe('#1F3A52');
});

test("remaps Chakra's built-in dark condition onto the night preset so its own dark-aware internals follow it", () => {
  const { night } = getPresetLayers();

  // Chakra's own default recipes (border, bg-subtle, color-palette scales, ...) are
  // conditioned on `_dark`, which chakra.jsx overrides from `.dark &` to `.night &` -
  // this is what keeps Button/Input/NativeSelect legible against a near-black
  // background without hand-restyling every primitive (see ADR 0002).
  expect(night['--chakra-colors-border']).toBe('var(--chakra-colors-gray-800)');
  expect(night['--chakra-colors-bg']).toBe('var(--chakra-colors-black)');
});
