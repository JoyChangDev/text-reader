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

  test("switching to Dark sets next-themes' active theme to dark on <html>", () => {
    renderToggle();

    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'dark' } });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  test("switching to Light sets next-themes' active theme to light on <html>", () => {
    renderToggle();

    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'dark' } });
    fireEvent.change(screen.getByLabelText(/theme/i), { target: { value: 'light' } });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
