'use client';

import { ThemeProvider } from 'next-themes';

// Chakra v3 dropped the built-in ColorMode/useColorMode - this wraps next-themes'
// own ThemeProvider instead. `attribute="class"` is required (not the next-themes
// default of `data-theme`): Chakra's `_dark` semantic-token condition resolves to the
// `.dark &` selector (see @chakra-ui/react's preset-base.js), so the active theme has
// to land on <html> as a `light`/`dark` class for the token scaffold in chakra.jsx to
// pick it up. Persistence and the no-flash-on-load behavior are both handled by
// next-themes itself (its own localStorage key, its own blocking inline script) -
// see ADR 0001's theme exception.
export function ColorModeProvider(props) {
  return <ThemeProvider attribute="class" disableTransitionOnChange {...props} />;
}
