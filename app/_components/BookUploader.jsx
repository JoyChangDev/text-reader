'use client';

import { Input, Text, VStack } from '@chakra-ui/react';
import { useState } from 'react';
import { FiUploadCloud } from 'react-icons/fi';

// Lets the reader pick or drop a .txt file, reads it client-side, and chunks it
// via /api/chunks. Hands the resulting { bookId, chunks } up to the parent once ready.
export default function BookUploader({ onReady }) {
  const [error, setError] = useState(null);

  async function processFile(file) {
    if (!file) return;

    setError(null);

    const text = await file.text();

    try {
      const response = await fetch('/api/chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Chunking failed');
      }

      const { chunks } = await response.json();
      onReady({ bookId: crypto.randomUUID(), chunks, title: file.name });
    } catch {
      setError("Couldn't process that file. Please try again.");
    }
  }

  function handleFileChange(event) {
    processFile(event.target.files?.[0]);
  }

  function handleDrop(event) {
    event.preventDefault();
    processFile(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  return (
    <VStack
      bg="backgroundElevated"
      color="foreground"
      align="center"
      gap={2}
      w="full"
      borderWidth="1.5px"
      borderStyle="dashed"
      borderColor="hairlineStrong"
      borderRadius="xl"
      px={4}
      py={7}
      textAlign="center"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      data-testid="book-dropzone"
    >
      <FiUploadCloud size={26} color="var(--chakra-colors-foreground-faint)" />
      <Text as="label" htmlFor="book-upload" fontWeight="600" fontSize="sm">
        Upload a .txt file to start listening, or drop one here
      </Text>
      <Input
        id="book-upload"
        type="file"
        accept=".txt"
        onChange={handleFileChange}
        w="auto"
        borderColor="hairlineStrong"
      />
      {error && (
        <Text color="danger" role="alert">
          {error}
        </Text>
      )}
    </VStack>
  );
}
