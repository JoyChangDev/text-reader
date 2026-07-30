// How far into a Book the Listener has gotten, purely from its resumeIndex/totalChunks
// (no per-chunk duration data is available at the library-list level - see
// libraryService.js's addBook, the only place totalChunks gets recorded). Returns null
// when there isn't enough data to say anything honest: a single-chunk book can't
// distinguish "never opened" from "listened to it" since resumeIndex stays 0 either
// way, and library entries persisted before totalChunks existed don't have the field
// at all - BookLibrary.jsx falls back to a plainer "resumed at chunk N" line for those
// rather than showing a fabricated bar.
export function summarizeBookProgress({ resumeIndex, totalChunks }) {
  if (typeof totalChunks !== 'number' || totalChunks <= 1) return null;

  const clampedIndex = Math.min(Math.max(resumeIndex, 0), totalChunks - 1);
  const percent = Math.round((clampedIndex / (totalChunks - 1)) * 100);

  return { percent, isComplete: clampedIndex === totalChunks - 1 };
}
