'use client';

import { Input, Text, VStack } from '@chakra-ui/react';
import { useState } from 'react';

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
      onReady({ bookId: crypto.randomUUID(), chunks });
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
      bg="background"
      color="foreground"
      align="start"
      gap={2}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      data-testid="book-dropzone"
    >
      <Text as="label" htmlFor="book-upload">
        Upload a .txt file to start listening, or drop one here
      </Text>
      <Input id="book-upload" type="file" accept=".txt" onChange={handleFileChange} />
      {error && (
        <Text color="danger" role="alert">
          {error}
        </Text>
      )}
    </VStack>
  );
}
