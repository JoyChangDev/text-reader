'use client';

import { Box, HStack, IconButton, Portal, Text, VisuallyHidden, VStack } from '@chakra-ui/react';
import { useState } from 'react';
import { FiSettings, FiX } from 'react-icons/fi';

import { AVAILABLE_SPEEDS, AVAILABLE_VOICES } from '@/app/_lib/listenerSettings';

import ThemeToggle from './ThemeToggle';
import { useVoicePreview, VoicePreviewButton } from './VoicePreview';

// Collapses the narration voice, playback speed, and appearance pickers that used to
// sit inline in PlayerBar behind a single disclosure, so the persistent bar stays
// short - opening it surfaces the same controls together with voice preview, so
// switching voice and hearing what it sounds like happen in the same place. Voice and
// speed are each a group of real radio inputs (voice as a list of rows, speed as
// segmented pills) rather than a NativeSelect, so every option is visible and
// tappable at once - see ThemeToggle for the same pattern applied to appearance.
// Disclosure state is local, same self-contained pattern PronunciationReportForm uses.
export default function PlayerSettingsSheet({
  voice,
  onVoiceChange,
  speed,
  onSpeedChange,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const { previewingVoice, togglePreviewVoice, audioProps } = useVoicePreview();

  return (
    <Box>
      <IconButton
        aria-label="設定"
        variant={open ? 'solid' : 'outline'}
        borderRadius="full"
        borderColor="hairlineStrong"
        onClick={() => setOpen((current) => !current)}
      >
        <FiSettings />
      </IconButton>
      {open && (
        // Portalled to document.body so `position: fixed` below is always resolved
        // against the viewport. Left in place, it would instead resolve against the
        // nearest ancestor carrying a `transform` - and this sheet renders inside
        // PlayerBar, deep in a route's tree, where a transform can appear on any
        // ancestor during a route transition and silently reanchor the whole overlay.
        <Portal>
          {/* Tapping outside the sheet dismisses it, same as the drag handle/close
              button. */}
          <Box
            data-testid="settings-sheet-backdrop"
            position="fixed"
            inset={0}
            bg="blackAlpha.500"
            zIndex={10}
            onClick={() => setOpen(false)}
          />
          <VStack
            data-testid="settings-sheet-panel"
            align="start"
            gap={4}
            position="fixed"
            left={0}
            right={0}
            bottom={0}
            maxW="640px"
            mx="auto"
            zIndex={11}
            bg="backgroundElevated"
            color="foreground"
            borderTopWidth="1px"
            borderColor="hairlineStrong"
            borderTopRadius="2xl"
            boxShadow="dark-lg"
            maxH="82dvh"
            overflowY="auto"
            px={5}
            // Keeps the sheet's last control clear of the home indicator on a Home
            // Screen (standalone) launch - see app/layout.jsx. The token's own value is
            // the fallback, so this still reads as "spacing 5, plus the inset".
            pb="calc(var(--chakra-spacing-5, 1.25rem) + env(safe-area-inset-bottom))"
            css={{
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            <Box w="9" h="1.5" borderRadius="full" bg="hairlineStrong" mx="auto" mt={3} mb={1} />

            <HStack justify="space-between" w="full">
              <Text fontWeight="bold">設定</Text>
              <IconButton
                aria-label="關閉設定"
                variant="plain"
                size="sm"
                onClick={() => setOpen(false)}
              >
                <FiX />
              </IconButton>
            </HStack>

            <VStack align="start" gap={2} w="full">
              <Text fontSize="sm" color="foregroundMuted">
                朗讀聲音
              </Text>
              {/* A list of real radio rows, not a NativeSelect - the demo this was
                  aligned to shows every voice at once (name + preview button per row)
                  rather than behind a closed dropdown. */}
              <VStack role="radiogroup" aria-label="朗讀聲音" align="stretch" gap={0} w="full">
                {AVAILABLE_VOICES.map((option) => (
                  <HStack
                    as="label"
                    key={option.value}
                    w="full"
                    justify="space-between"
                    py={2}
                    borderTopWidth="1px"
                    borderColor="hairline"
                    _first={{ borderTopWidth: 0 }}
                    cursor={disabled ? 'not-allowed' : 'pointer'}
                    opacity={disabled ? 0.6 : 1}
                  >
                    <HStack gap={2} minW={0}>
                      <Box
                        as="input"
                        type="radio"
                        name="settings-voice"
                        value={option.value}
                        checked={voice === option.value}
                        disabled={disabled}
                        onChange={onVoiceChange}
                        css={{ accentColor: 'var(--chakra-colors-accent)' }}
                        boxSize="4"
                        flexShrink={0}
                      />
                      <Text fontSize="sm" fontWeight="600">
                        {option.label}
                      </Text>
                    </HStack>
                    <VoicePreviewButton
                      voice={option}
                      previewingVoice={previewingVoice}
                      onToggle={togglePreviewVoice}
                    />
                  </HStack>
                ))}
              </VStack>
              <audio {...audioProps} />
            </VStack>

            <VStack align="start" gap={2} w="full">
              <Text fontSize="sm" color="foregroundMuted">
                播放速度
              </Text>
              {/* Segmented pills of real radio inputs, same pattern as ThemeToggle -
                  every preset visible and tappable at once, matching the demo. */}
              <Box role="radiogroup" aria-label="播放速度" display="flex" gap={2} flexWrap="wrap">
                {AVAILABLE_SPEEDS.map((option) => {
                  const checked = Number(speed) === option;
                  return (
                    <Box
                      as="label"
                      key={option}
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
                      cursor={disabled ? 'not-allowed' : 'pointer'}
                      opacity={disabled ? 0.6 : 1}
                    >
                      <VisuallyHidden>
                        <input
                          type="radio"
                          name="settings-speed"
                          value={option}
                          checked={checked}
                          disabled={disabled}
                          onChange={onSpeedChange}
                        />
                      </VisuallyHidden>
                      {option}x
                    </Box>
                  );
                })}
              </Box>
            </VStack>

            <VStack align="start" gap={2} w="full" pb={2}>
              <Text fontSize="sm" color="foregroundMuted">
                外觀
              </Text>
              <ThemeToggle />
            </VStack>
          </VStack>
        </Portal>
      )}
    </Box>
  );
}
