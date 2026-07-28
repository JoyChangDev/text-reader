'use client';

import {
  ChakraProvider as Provider,
  createSystem,
  defaultConfig,
  defineConfig,
} from '@chakra-ui/react';

const config = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        background: { value: '{colors.bg}' },
        foreground: { value: '{colors.fg}' },
        accent: { value: '{colors.blue.500}' },
        danger: { value: '{colors.red.500}' },
        activeSentenceBg: { value: '{colors.yellow.200}' },
        activeSentenceFg: { value: '{colors.black}' },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

export default function ChakraProvider({ children }) {
  return <Provider value={system}>{children}</Provider>;
}
