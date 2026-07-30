'use client';

import { Box, Button, HStack, NativeSelect, Text, VStack } from '@chakra-ui/react';
import { useState } from 'react';
import { FiSettings, FiX } from 'react-icons/fi';

import { AVAILABLE_SPEEDS, AVAILABLE_VOICES } from '@/app/_lib/listenerSettings';

import ThemeToggle from './ThemeToggle';
import VoicePreview from './VoicePreview';

// Collapses the narration voice, playback speed, and appearance pickers that used to
// sit inline in PlayerBar behind a single disclosure, so the persistent bar stays
// short - opening it surfaces the same controls together with voice preview, so
// switching voice and hearing what it sounds like happen in the same place. The
// voice/speed pickers themselves are unchanged (same NativeSelects PlayerBar used to
// render directly), just relocated - only where they live moved, not how they work.
// Disclosure state is local, same self-contained pattern PronunciationReportForm uses.
export default function PlayerSettingsSheet({
  voice,
  onVoiceChange,
  speed,
  onSpeedChange,
  disabled,
}) {
  const [open, setOpen] = useState(false);

  return (
    <Box position="relative">
      <Button
        aria-label="Settings"
        variant={open ? 'solid' : 'outline'}
        onClick={() => setOpen((current) => !current)}
      >
        <FiSettings />
      </Button>
      {open && (
        <VStack
          align="start"
          gap={4}
          position="absolute"
          bottom="calc(100% + 8px)"
          left={0}
          zIndex={1}
          bg="background"
          color="foreground"
          p={4}
          borderRadius="md"
          borderWidth="1px"
          boxShadow="md"
          minW="64"
        >
          <HStack justify="space-between" w="full">
            <Text fontWeight="bold">Settings</Text>
            <Button
              aria-label="Close settings"
              variant="plain"
              size="sm"
              onClick={() => setOpen(false)}
            >
              <FiX />
            </Button>
          </HStack>

          <VStack align="start" gap={2} w="full">
            <Text as="label" fontSize="sm" htmlFor="settings-voice">
              Narration voice
            </Text>
            <NativeSelect.Root disabled={disabled}>
              <NativeSelect.Field
                id="settings-voice"
                aria-label="Narration voice"
                value={voice}
                onChange={onVoiceChange}
              >
                {AVAILABLE_VOICES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            <HStack wrap="wrap">
              <VoicePreview />
            </HStack>
          </VStack>

          <VStack align="start" gap={2} w="full">
            <Text as="label" fontSize="sm" htmlFor="settings-speed">
              Playback speed
            </Text>
            <NativeSelect.Root disabled={disabled}>
              <NativeSelect.Field
                id="settings-speed"
                aria-label="Playback speed"
                value={speed}
                onChange={onSpeedChange}
              >
                {AVAILABLE_SPEEDS.map((option) => (
                  <option key={option} value={option}>
                    {option}x
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </VStack>

          <VStack align="start" gap={2} w="full">
            <Text fontSize="sm">Appearance</Text>
            <ThemeToggle />
          </VStack>
        </VStack>
      )}
    </Box>
  );
}
