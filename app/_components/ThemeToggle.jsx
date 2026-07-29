'use client';

import { ClientOnly, NativeSelect, Skeleton } from '@chakra-ui/react';
import { useTheme } from 'next-themes';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// next-themes only knows the persisted theme after mount (it reads localStorage
// client-side to avoid the SSR flash-of-wrong-theme - see ADR 0001's theme
// exception), so the picker is wrapped in ClientOnly per Chakra v3's documented
// next-themes pattern rather than rendering a value that would mismatch on hydrate.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <ClientOnly fallback={<Skeleton w="24" h="8" />}>
      <NativeSelect.Root width="auto">
        <NativeSelect.Field
          aria-label="Theme"
          value={theme ?? 'system'}
          onChange={(event) => setTheme(event.target.value)}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </ClientOnly>
  );
}
