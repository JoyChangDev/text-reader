import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import ChakraProvider from '../_providers/chakra';
import { ColorModeProvider } from '../_providers/colorMode';
import ThemeToggle from './ThemeToggle';

function renderToggle() {
  return render(
    <ColorModeProvider>
      <ChakraProvider>
        <ThemeToggle />
      </ChakraProvider>
    </ColorModeProvider>,
  );
}

const LABEL_BY_VALUE = { paper: '紙感', night: '夜間', soft: '柔和' };

describe('ThemeToggle', () => {
  test('defaults to the paper preset', () => {
    renderToggle();

    expect(screen.getByRole('radio', { name: '紙感' })).toBeChecked();
  });

  test('offers exactly the three presets chakra.jsx defines conditions for', () => {
    renderToggle();

    const options = screen.getAllByRole('radio').map((option) => option.value);
    expect(options).toEqual(['paper', 'night', 'soft']);
  });

  test.each(['paper', 'night', 'soft'])(
    "switching to %s sets next-themes' active theme to the %s class on <html>",
    (value) => {
      renderToggle();

      fireEvent.click(screen.getByRole('radio', { name: LABEL_BY_VALUE[value] }));

      expect(document.documentElement.classList.contains(value)).toBe(true);
      ['paper', 'night', 'soft']
        .filter((other) => other !== value)
        .forEach((other) => expect(document.documentElement.classList.contains(other)).toBe(false));
    },
  );
});
