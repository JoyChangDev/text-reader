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

describe('ThemeToggle', () => {
  test('defaults to following the system theme', () => {
    renderToggle();

    expect(screen.getByLabelText(/theme/i)).toHaveValue('system');
  });

  // ColorModeProvider's `value` map remaps next-themes' own 'dark'/'light' resolution
  // onto the 'night'/'paper' classes chakra.jsx's presets key off of (see ADR 0002) -
  // picking "Dark"/"Light" here still works, it just lands a different class name.
  test("switching to Dark sets next-themes' active theme to the night preset on <html>", () => {
    renderToggle();

    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'dark' } });

    expect(document.documentElement.classList.contains('night')).toBe(true);
    expect(document.documentElement.classList.contains('paper')).toBe(false);
  });

  test("switching to Light sets next-themes' active theme to the paper preset on <html>", () => {
    renderToggle();

    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'dark' } });
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'light' } });

    expect(document.documentElement.classList.contains('paper')).toBe(true);
    expect(document.documentElement.classList.contains('night')).toBe(false);
  });
});
