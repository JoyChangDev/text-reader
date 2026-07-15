"use client";

import {
  ChakraProvider as Provider,
  createSystem,
  defaultConfig,
  defineConfig,
} from "@chakra-ui/react";

export const system = createSystem(defaultConfig, defineConfig({}));

export default function ChakraProvider({ children }) {
  return <Provider value={system}>{children}</Provider>;
}
