const SENTENCE_PATTERN = /[^。！？]*[。！？]+[」』"'）】]*/g;

export function splitIntoSentences(text) {
  const sentences = [];
  // Track where the last matched sentence ended so trailing text can be added later.
  let lastIndex = 0;

  // Find every sentence-like match; match[0] is the full sentence text.
  for (const match of text.matchAll(SENTENCE_PATTERN)) {
    if (match[0].length === 0) continue;
    sentences.push(match[0]);
    // Move lastIndex to the end of this matched sentence.
    lastIndex = match.index + match[0].length;
  }

  // Add any leftover text that did not end with sentence punctuation.
  const remainder = text.slice(lastIndex);
  if (remainder.trim().length > 0) {
    sentences.push(remainder);
  }

  // Trim whitespace and remove empty strings before chunking.
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export function chunkText(text, { maxChars = 200, maxSentencesPerChunk = 4 } = {}) {
  const sentences = splitIntoSentences(text);
  const chunks = [];
  let current = '';
  let sentenceCount = 0;

  // Save the current chunk and reset the chunk state.
  const flushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
      sentenceCount = 0;
    }
  };

  for (const sentence of sentences) {
    // Check whether adding this sentence would break either chunk limit.
    const wouldExceedMaxChars = current.length + sentence.length > maxChars;
    const wouldExceedSentenceCount = sentenceCount >= maxSentencesPerChunk;

    // Start a new chunk before adding the sentence if the current one is full.
    if (current.length > 0 && (wouldExceedMaxChars || wouldExceedSentenceCount)) {
      flushCurrent();
    }

    // If one sentence is too long by itself, split it by character count.
    if (sentence.length > maxChars) {
      flushCurrent();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }

    // Add the sentence to the current chunk.
    current += sentence;
    sentenceCount += 1;
  }

  // Save the final unfinished chunk.
  flushCurrent();

  return chunks;
}
