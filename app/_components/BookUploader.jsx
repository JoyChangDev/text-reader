'use client';

import { Button, Text, VisuallyHidden, VStack } from '@chakra-ui/react';
import { useRef, useState } from 'react';
import { FiUploadCloud } from 'react-icons/fi';

// Lets the reader pick or drop a .txt file, reads it client-side, and chunks it
// via /api/chunks. Hands the resulting { bookId, chunks } up to the parent once ready.
export default function BookUploader({ onReady }) {
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

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
      setError('無法處理這個檔案，請再試一次。');
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
        上傳 .txt 檔案開始聆聽，或將檔案拖曳到這裡
      </Text>
      {/* The native input stays in the DOM (and keeps its id/label association, so
          getByLabelText/fireEvent.change still work exactly as before) but is visually
          hidden - the accent button below is a standard hidden-input-plus-trigger-button
          pattern, matching the demo's "選擇檔案" button instead of the browser's own
          file-picker chrome. */}
      <VisuallyHidden>
        <input
          ref={inputRef}
          id="book-upload"
          type="file"
          accept=".txt"
          onChange={handleFileChange}
        />
      </VisuallyHidden>
      <Button
        type="button"
        size="sm"
        borderRadius="full"
        bg="accent"
        color="accentContrast"
        _hover={{ opacity: 0.9 }}
        onClick={() => inputRef.current?.click()}
      >
        選擇檔案
      </Button>
      {error && (
        <Text color="danger" role="alert">
          {error}
        </Text>
      )}
    </VStack>
  );
}
