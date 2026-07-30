// How far into a Book the Listener has gotten. Prefers Sentence-level data
// (sentenceCountsByChunk/resumeSentenceIndex, recorded at addBook time - see
// libraryService.js) since it matches what's actually visible on screen; falls back to
// the coarser Chunk-level calculation for Library entries persisted before that data
// existed (see ticket 04). Both paths return null when there isn't enough data to say
// anything honest: a book with only one Chunk/Sentence can't distinguish "never opened"
// from "listened to it" since the resume position stays at 0 either way.
export function summarizeBookProgress({
  resumeIndex,
  totalChunks,
  resumeSentenceIndex,
  sentenceCountsByChunk,
}) {
  if (Array.isArray(sentenceCountsByChunk)) {
    return summarizeSentenceProgress({ resumeIndex, resumeSentenceIndex, sentenceCountsByChunk });
  }

  if (typeof totalChunks !== 'number' || totalChunks <= 1) return null;

  const clampedIndex = Math.min(Math.max(resumeIndex, 0), totalChunks - 1);
  const percent = Math.round((clampedIndex / (totalChunks - 1)) * 100);

  return { percent, isComplete: clampedIndex === totalChunks - 1 };
}

// A Sentence ordinal is the count of Sentences the Listener has fully reached, counting
// every Sentence in every Chunk before the resumed one, plus resumeSentenceIndex within
// it - the same shape of calculation the Chunk-level path above does, just operating
// over per-Chunk Sentence counts instead of Chunk counts directly (see ticket 04).
export function summarizeSentenceProgress({
  resumeIndex,
  resumeSentenceIndex = 0,
  sentenceCountsByChunk,
}) {
  const totalSentences = sentenceCountsByChunk.reduce((sum, count) => sum + count, 0);
  if (totalSentences <= 1) return null;

  const clampedChunkIndex = Math.min(Math.max(resumeIndex, 0), sentenceCountsByChunk.length - 1);
  const priorSentences = sentenceCountsByChunk
    .slice(0, clampedChunkIndex)
    .reduce((sum, count) => sum + count, 0);
  const chunkSentenceCount = sentenceCountsByChunk[clampedChunkIndex] ?? 1;
  const clampedSentenceIndex = Math.min(Math.max(resumeSentenceIndex, 0), chunkSentenceCount - 1);

  const ordinal = Math.min(Math.max(priorSentences + clampedSentenceIndex, 0), totalSentences - 1);
  const percent = Math.round((ordinal / (totalSentences - 1)) * 100);

  return { percent, isComplete: ordinal === totalSentences - 1 };
}
