const SENTENCE_PATTERN = /[^。！？]*[。！？]+[」』"'）】]*/g;

function splitIntoSentences(text) {
  const sentences = [];
  let lastIndex = 0;

  for (const match of text.matchAll(SENTENCE_PATTERN)) {
    if (match[0].length === 0) continue;
    sentences.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  const remainder = text.slice(lastIndex);
  if (remainder.trim().length > 0) {
    sentences.push(remainder);
  }

  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export function chunkText(text, { maxChars = 200, maxSentencesPerChunk = 4 } = {}) {
  const sentences = splitIntoSentences(text);
  const chunks = [];
  let current = '';
  let sentenceCount = 0;

  const flushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
      sentenceCount = 0;
    }
  };

  for (const sentence of sentences) {
    const wouldExceedMaxChars = current.length + sentence.length > maxChars;
    const wouldExceedSentenceCount = sentenceCount >= maxSentencesPerChunk;

    if (current.length > 0 && (wouldExceedMaxChars || wouldExceedSentenceCount)) {
      flushCurrent();
    }

    if (sentence.length > maxChars) {
      flushCurrent();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }

    current += sentence;
    sentenceCount += 1;
  }

  flushCurrent();

  return chunks;
}
