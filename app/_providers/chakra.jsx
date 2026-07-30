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
        foreground: {
          value: { _paper: '#262320', _night: '#ECE7DC', _soft: '#2E3944' },
        },
        accent: {
          value: { _paper: '#7A5313', _night: '#E8A961', _soft: '#7C86D9' },
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
