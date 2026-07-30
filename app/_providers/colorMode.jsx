'use client';

import { ThemeProvider } from 'next-themes';

// Chakra v3 dropped the built-in ColorMode/useColorMode - this wraps next-themes'
// own ThemeProvider instead. `attribute="class"` still lands the active theme on
// <html> as a class, which chakra.jsx's custom _paper/_night/_soft conditions (plus
// its `dark` condition, remapped to `.night`) key off of - see ADR 0002. `value`
// remaps next-themes' own internal 'light'/'dark' resolution (used by enableSystem's
// OS-preference detection, and still understood by setTheme) onto 'paper'/'night'
// respectively, so ThemeToggle's existing light/dark/system picker keeps working
// unchanged against the new three-class system - only 'soft' has no light/dark
// equivalent to fall back to, so it isn't reachable until ThemeToggle is reworked to
// expose all three presets directly. `defaultTheme` is deliberately left unset here
// (next-themes' own default of 'system') so this token/plumbing change stays
// behavior-preserving; switching the shipped default to 'paper' belongs with that
// same ThemeToggle rework. Persistence and the no-flash-on-load behavior are both
// handled by next-themes itself (its own localStorage key, its own blocking inline
// script) - see ADR 0001's theme exception.
export function ColorModeProvider(props) {
  return (
    <ThemeProvider
      attribute="class"
      themes={['paper', 'night', 'soft']}
      value={{ paper: 'paper', night: 'night', soft: 'soft', light: 'paper', dark: 'night' }}
      disableTransitionOnChange
      {...props}
    />
  );
}
