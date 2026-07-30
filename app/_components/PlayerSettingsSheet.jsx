'use client';

import { Box, HStack, IconButton, NativeSelect, Text, VStack } from '@chakra-ui/react';
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
    <Box>
      <IconButton
        aria-label="Settings"
        variant={open ? 'solid' : 'outline'}
        borderRadius="full"
        borderColor="hairlineStrong"
        onClick={() => setOpen((current) => !current)}
      >
        <FiSettings />
      </IconButton>
      {open && (
        <>
          {/* Tapping outside the sheet dismisses it, same as the drag handle/close
              button - a fixed overlay works here without a portal since none of this
              tree applies a transform, which is the one thing that would otherwise
              make `position: fixed` relative to something other than the viewport. */}
          <Box
            position="fixed"
            inset={0}
            bg="blackAlpha.500"
            zIndex={10}
            onClick={() => setOpen(false)}
          />
          <VStack
            align="start"
            gap={4}
            position="fixed"
            left={0}
            right={0}
            bottom={0}
            zIndex={11}
            bg="backgroundElevated"
            color="foreground"
            borderTopWidth="1px"
            borderColor="hairlineStrong"
            borderTopRadius="2xl"
            boxShadow="dark-lg"
            maxH="82vh"
            overflowY="auto"
            px={5}
            pb={5}
          >
            <Box w="9" h="1.5" borderRadius="full" bg="hairlineStrong" mx="auto" mt={3} mb={1} />

            <HStack justify="space-between" w="full">
              <Text fontWeight="bold">Settings</Text>
              <IconButton
                aria-label="Close settings"
                variant="plain"
                size="sm"
                onClick={() => setOpen(false)}
              >
                <FiX />
              </IconButton>
            </HStack>

            <VStack align="start" gap={2} w="full">
              <Text as="label" fontSize="sm" color="foregroundMuted" htmlFor="settings-voice">
                Narration voice
              </Text>
              <NativeSelect.Root disabled={disabled}>
                <NativeSelect.Field
                  id="settings-voice"
                  aria-label="Narration voice"
                  value={voice}
                  onChange={onVoiceChange}
                  borderColor="hairlineStrong"
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
              <Text as="label" fontSize="sm" color="foregroundMuted" htmlFor="settings-speed">
                Playback speed
              </Text>
              <NativeSelect.Root disabled={disabled}>
                <NativeSelect.Field
                  id="settings-speed"
                  aria-label="Playback speed"
                  value={speed}
                  onChange={onSpeedChange}
                  borderColor="hairlineStrong"
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

            <VStack align="start" gap={2} w="full" pb={2}>
              <Text fontSize="sm" color="foregroundMuted">
                Appearance
              </Text>
              <ThemeToggle />
            </VStack>
          </VStack>
        </>
      )}
    </Box>
  );
}
