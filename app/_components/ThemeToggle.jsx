'use client';

import { Box, ClientOnly, Skeleton, VisuallyHidden } from '@chakra-ui/react';
import { useTheme } from 'next-themes';

const THEME_OPTIONS = [
  { value: 'paper', label: 'Paper' },
  { value: 'night', label: 'Night' },
  { value: 'soft', label: 'Soft' },
];

// next-themes only knows the persisted theme after mount (it reads localStorage
// client-side to avoid the SSR flash-of-wrong-theme - see ADR 0001's theme
// exception), so the picker is wrapped in ClientOnly per Chakra v3's documented
// next-themes pattern rather than rendering a value that would mismatch on hydrate.
// The three options are the presets chakra.jsx defines conditions for (see ADR
// 0002) - there's no fourth "follow the OS" option since the OS only ever knows
// light/dark, not a three-way aesthetic choice.
//
// Rendered as a segmented group of real radio inputs (each visually hidden inside
// its own label, which supplies the pill styling) rather than a NativeSelect - a
// select hides the other options behind a closed dropdown, but the UI/UX demo this
// was aligned to shows every preset at once as tappable pills. Native radios keep
// the same keyboard/group semantics a select would have had, just laid out
// differently.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = theme ?? 'paper';

  return (
    <ClientOnly fallback={<Skeleton w="40" h="8" />}>
      <Box role="radiogroup" aria-label="Theme" display="flex" gap={2} flexWrap="wrap">
        {THEME_OPTIONS.map((option) => {
          const checked = current === option.value;
          return (
            <Box
              as="label"
              key={option.value}
              display="inline-flex"
              alignItems="center"
              fontSize="xs"
              fontWeight="700"
              px={3}
              py={2}
              borderRadius="md"
              borderWidth="1px"
              borderColor={checked ? 'transparent' : 'hairlineStrong'}
              bg={checked ? 'accent' : 'backgroundElevated'}
              color={checked ? 'accentContrast' : 'foregroundMuted'}
              cursor="pointer"
            >
              <VisuallyHidden>
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={checked}
                  onChange={() => setTheme(option.value)}
                />
              </VisuallyHidden>
              {option.label}
            </Box>
          );
        })}
      </Box>
    </ClientOnly>
  );
}
