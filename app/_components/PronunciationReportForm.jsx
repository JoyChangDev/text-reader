'use client';

import { Box, Button, Text, Textarea, VStack } from '@chakra-ui/react';
import { useState } from 'react';

import { submitReport } from '@/app/_lib/pronunciationReports';

// Surfaced by TranscriptView when the reader selects a phrase in the transcript (see
// ticket 10): a collapsed affordance that expands into a report form pre-filled with the
// selected phrase and the book's title. Reports are stored for manual review only - no
// automatic pronunciation correction or SSML override happens here. TranscriptView keys
// this component by phrase, so a fresh selection always mounts back at the collapsed
// affordance rather than carrying over a previous phrase's in-progress form.
export default function PronunciationReportForm({ phrase, bookTitle, onDismiss }) {
  const [open, setOpen] = useState(false);
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

  if (!open) {
    return (
      <Button
        size="sm"
        position="absolute"
        top={4}
        right={4}
        zIndex={1}
        // Preserves the browser selection through the click - mousedown outside the
        // selected text would otherwise collapse it before onClick fires. Not that it
        // matters here, since the phrase was already captured into state on mouseup.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
      >
        Report pronunciation issue
      </Button>
    );
  }

  if (status === 'submitted') {
    return (
      <VStack
        align="start"
        gap={2}
        position="absolute"
        top={4}
        right={4}
        zIndex={1}
        bg="background"
        color="foreground"
        p={3}
        borderRadius="md"
        boxShadow="md"
      >
        <Text role="status">Thanks, we&apos;ll take a look.</Text>
        <Button size="sm" variant="plain" onClick={onDismiss}>
          Dismiss
        </Button>
      </VStack>
    );
  }

  return (
    <Box
      as="form"
      onSubmit={handleSubmit}
      position="absolute"
      top={4}
      right={4}
      zIndex={1}
      bg="background"
      color="foreground"
      p={3}
      borderRadius="md"
      boxShadow="md"
      w="xs"
    >
      <VStack align="start" gap={2}>
        <Text fontWeight="bold">Report pronunciation issue</Text>
        <Text>{bookTitle}</Text>
        <Text>{phrase}</Text>
        <Text as="label" htmlFor="pronunciation-report-description">
          Description (optional)
        </Text>
        <Textarea
          id="pronunciation-report-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {status === 'error' && (
          <Text role="alert" color="danger">
            Couldn&apos;t submit the report. Please try again.
          </Text>
        )}
        <Box>
          <Button type="submit" size="sm" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Submitting…' : 'Submit'}
          </Button>
          <Button size="sm" variant="plain" onClick={onDismiss}>
            Cancel
          </Button>
        </Box>
      </VStack>
    </Box>
  );
}
