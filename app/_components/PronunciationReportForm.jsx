'use client';

import { Box, Button, Portal, Text, Textarea, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { submitReport } from '@/app/_lib/pronunciationReports';

// A successful submission exits report mode on its own, after a brief pause that leaves
// the confirmation copy visible - not a separate manual dismiss step (see ticket 06).
const SUCCESS_AUTO_DISMISS_MS = 1200;

// Surfaced while report mode is active and the reader selects a phrase in the
// transcript (see ticket 06): a centered modal - full-viewport dimming backdrop behind
// a centered card - pre-filled with the selected phrase and the book's title. Reports
// are stored for manual review only - no automatic pronunciation correction or SSML
// override happens here. TranscriptView keys this component by phrase, so a fresh
// selection always mounts back at a blank form rather than carrying over a previous
// phrase's in-progress state.
export default function PronunciationReportForm({ phrase, bookTitle, onDismiss }) {
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | submitted | error

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus('submitting');
    try {
      await submitReport({ bookTitle, phrase, description });
      setStatus('submitted');
    } catch (error) {
      console.error('Submitting the pronunciation report failed', error);
      setStatus('error');
    }
  }

  useEffect(() => {
    if (status !== 'submitted') return undefined;
    const timeout = setTimeout(onDismiss, SUCCESS_AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [status, onDismiss]);

  return (
    // Portalled for the same reason PlayerSettingsSheet is (see its own comment): this
    // renders from deep inside TranscriptView, and `position: fixed` resolves against
    // the nearest transformed ancestor rather than the viewport if there is one.
    <Portal>
      {/* Same full-viewport dimming backdrop pattern PlayerSettingsSheet's overlay
          already establishes. */}
      <Box
        data-testid="pronunciation-report-backdrop"
        position="fixed"
        inset={0}
        bg="blackAlpha.500"
        zIndex={20}
        onClick={onDismiss}
      />
      <VStack
        data-testid="pronunciation-report-modal"
        align="start"
        gap={2}
        position="fixed"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        zIndex={21}
        bg="backgroundElevated"
        color="foreground"
        p={4}
        borderWidth="1px"
        borderColor="hairlineStrong"
        borderRadius="xl"
        boxShadow="dark-lg"
        w="xs"
        maxW="90vw"
      >
        <Text fontWeight="bold" fontSize="sm">
          回報發音問題
        </Text>
        <Text fontSize="xs" color="foregroundMuted">
          {bookTitle}
        </Text>
        <Text
          display="inline-block"
          bg="activeSentenceBg"
          color="activeSentenceFg"
          borderRadius="md"
          px={2}
          py={1}
          fontSize="sm"
        >
          {phrase}
        </Text>

        {status === 'submitted' ? (
          <Text role="status">謝謝，我們會盡快查看。</Text>
        ) : (
          <Box as="form" onSubmit={handleSubmit} w="full">
            <VStack align="start" gap={2} w="full">
              <Text
                as="label"
                fontSize="xs"
                color="foregroundMuted"
                htmlFor="pronunciation-report-description"
              >
                描述（選填）
              </Text>
              <Textarea
                id="pronunciation-report-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                borderColor="hairlineStrong"
                resize="none"
              />
              {status === 'error' && (
                <Text role="alert" color="danger" fontSize="sm">
                  回報送出失敗，請再試一次。
                </Text>
              )}
              {/* Submit sits at the row's true horizontal center regardless of Cancel's
                  own position; Cancel is right-aligned via the row's own flex end - an
                  explicit layout requirement, not left to either button's default
                  alignment (see ticket 06). */}
              <Box position="relative" display="flex" justifyContent="flex-end" w="full" mt={2}>
                <Button
                  type="submit"
                  position="absolute"
                  left="50%"
                  transform="translateX(-50%)"
                  size="sm"
                  bg="accent"
                  color="accentContrast"
                  _hover={{ opacity: 0.9 }}
                  disabled={status === 'submitting'}
                >
                  {status === 'submitting' ? '送出中…' : '送出'}
                </Button>
                <Button size="sm" variant="ghost" onClick={onDismiss}>
                  取消
                </Button>
              </Box>
            </VStack>
          </Box>
        )}
      </VStack>
    </Portal>
  );
}
