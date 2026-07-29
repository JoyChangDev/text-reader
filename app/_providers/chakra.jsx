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
        background: { value: { _light: '{colors.white}', _dark: '{colors.gray.950}' } },
        foreground: { value: { _light: '{colors.gray.900}', _dark: '{colors.gray.50}' } },
        accent: { value: { _light: '{colors.blue.600}', _dark: '{colors.blue.300}' } },
        danger: { value: { _light: '{colors.red.600}', _dark: '{colors.red.400}' } },
        activeSentenceBg: {
          value: { _light: '{colors.yellow.200}', _dark: '{colors.yellow.600}' },
        },
        activeSentenceFg: { value: { _light: '{colors.black}', _dark: '{colors.black}' } },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

export default function ChakraProvider({ children }) {
  return <Provider value={system}>{children}</Provider>;
}
