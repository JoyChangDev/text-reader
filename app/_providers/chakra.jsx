'use client';

import {
  ChakraProvider as Provider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react';

// Three named presets replace the old binary light/dark (see ADR 0002). `dark` is
// remapped from Chakra's built-in `.dark &` selector to `.night &`, so Chakra's own
// dark-aware component internals (Button/Input/NativeSelect border, focus-ring,
// disabled-state colors) follow the "night" preset automatically, without us having to
// hand-restyle every primitive. `paper`/`night`/`soft` are new custom conditions for our
// own semantic tokens below - exactly one of the three classes is ever present on <html>
// at a time (see colorMode.jsx).
const config = defineConfig({
  conditions: {
    dark: '.night &',
    paper: '.paper &',
    night: '.night &',
    soft: '.soft &',
  },
  theme: {
    semanticTokens: {
      colors: {
        background: {
          value: { _paper: '#F1EFE8', _night: '#0B0C0E', _soft: '#EFF3F6' },
        },
        // One step up from `background` - cards, the dropzone, the settings sheet,
        // anything meant to read as "raised" above the page (see the UI/UX demo
        // artifact this palette was lifted from).
        backgroundElevated: {
          value: { _paper: '#FBFAF5', _night: '#17181B', _soft: '#FFFFFF' },
        },
        // One step down from `background` - track fills (usage/progress bars) sit
        // here so the accent-filled portion has something to contrast against.
        backgroundSunken: {
          value: { _paper: '#E7E3D6', _night: '#1E1F23', _soft: '#E3E9EE' },
        },
        foreground: {
          value: { _paper: '#262320', _night: '#ECE7DC', _soft: '#2E3944' },
        },
        foregroundMuted: {
          value: { _paper: '#6B655B', _night: '#9C968A', _soft: '#66727C' },
        },
        foregroundFaint: {
          value: { _paper: '#948C7D', _night: '#6E695F', _soft: '#93A0AA' },
        },
        // Named `hairline`, not `border` - Chakra's defaultConfig already owns a
        // `border` semantic token (its own component recipes key off it, remapped to
        // the night preset via the `dark` condition above); reusing that name here
        // would silently override Chakra's own value instead of adding a new one.
        hairline: {
          value: {
            _paper: '#DEDACD',
            _night: 'rgba(255, 255, 255, 0.08)',
            _soft: '#DCE4EA',
          },
        },
        hairlineStrong: {
          value: {
            _paper: '#C7C1AE',
            _night: 'rgba(255, 255, 255, 0.16)',
            _soft: '#C7D2DA',
          },
        },
        accent: {
          value: { _paper: '#7A5313', _night: '#E8A961', _soft: '#7C86D9' },
        },
        // Text/icon color for content painted on top of a solid `accent` fill (the
        // play button, active segmented controls) - not the same axis as
        // foreground/background, so it gets its own token rather than reusing them.
        accentContrast: {
          value: { _paper: '#FBF3E1', _night: '#231404', _soft: '#FFFFFF' },
        },
        danger: {
          value: { _paper: '#A23E2E', _night: '#E2725A', _soft: '#D97078' },
        },
        activeSentenceBg: {
          value: {
            _paper: '#F3DFA0',
            _night: 'rgba(232, 169, 97, 0.22)',
            _soft: '#D8E6F5',
          },
        },
        activeSentenceFg: {
          value: { _paper: '#2A2013', _night: '#F3C888', _soft: '#1F3A52' },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

export default function ChakraProvider({ children }) {
  return <Provider value={system}>{children}</Provider>;
}
