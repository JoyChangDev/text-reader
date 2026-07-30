'use client';

import { ThemeProvider } from 'next-themes';

// Chakra v3 dropped the built-in ColorMode/useColorMode - this wraps next-themes'
// own ThemeProvider instead. `attribute="class"` lands the active preset on <html>
// as a class, which chakra.jsx's custom _paper/_night/_soft conditions (plus its
// `dark` condition, remapped to `.night`) key off of - see ADR 0002. ThemeToggle now
// sets 'paper'/'night'/'soft' directly, so the `value` remap from the transitional
// light/dark/system picker (see commit 9e2c977) is gone; `enableSystem` is off since
// there's no fourth "follow the OS" preset in this three-way model - paper is simply
// the default. Persistence and the no-flash-on-load behavior are both handled by
// next-themes itself (its own localStorage key, its own blocking inline script) -
// see ADR 0001's theme exception.
export function ColorModeProvider(props) {
  return (
    <ThemeProvider
      attribute="class"
      themes={['paper', 'night', 'soft']}
      defaultTheme="paper"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    />
  );
}
