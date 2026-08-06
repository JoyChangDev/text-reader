import { splitIntoSentences } from './chunkText';

// A Book-global Sentence ordinal is the identity a metadata cue carries: cue N is the
// Nth Sentence of the Book, counted straight through Chunk boundaries. The player holds
// the reading position in that form, because the timeline it plays is Book-wide too -
// see .scratch/phase-1-10-continuous-hls-playback/issues/05-metadata-cues-and-seeking.md.
//
// Ordinals are counted from the Chunk text alone, never from what happens to be
// generated, so a Sentence keeps its ordinal as the Book fills in around it. That is the
// same rule bookManifest.js counts by on the server (both via splitIntoSentences), which
// is what makes a cue id from the manifest mean the same Sentence here.
//
// This is the translation layer at the edges: (chunkIndex, sentenceIndex) is still the
// shape TranscriptView renders and the library stores, and neither of them has any
// reason to learn about the Book-wide timeline.
export function sentenceOrdinals(chunks) {
  const counts = chunks.map((text) => splitIntoSentences(text).length);

  // The ordinal each Chunk's first Sentence gets - a running total, so a Chunk with no
  // Sentences shares its successor's starting ordinal and can never claim one of its own.
  const firstOrdinals = [];
  let running = 0;
  for (const count of counts) {
    firstOrdinals.push(running);
    running += count;
  }
  const total = running;

  // Every position out of range clamps into the Book rather than propagating: the
  // callers are a stored resume position (which can outlive the chunking it was saved
  // against) and a cue id, and both are better off naming a real Sentence.
  const clamp = (ordinal) => Math.min(Math.max(ordinal, 0), Math.max(total - 1, 0));

  return {
    total,

    toOrdinal(chunkIndex, sentenceIndex) {
      const index = Math.min(Math.max(chunkIndex, 0), chunks.length - 1);
      if (index < 0) return 0;
      return clamp(firstOrdinals[index] + Math.max(sentenceIndex, 0));
    },

    toChunkPosition(ordinal) {
      const target = clamp(ordinal);
      // Walk backwards to the last Chunk that actually starts at or before the target
      // and holds at least one Sentence - forwards would stop on an empty Chunk whose
      // firstOrdinal equals the target.
      for (let index = chunks.length - 1; index >= 0; index -= 1) {
        if (counts[index] > 0 && firstOrdinals[index] <= target) {
          return { chunkIndex: index, sentenceIndex: target - firstOrdinals[index] };
        }
      }
      return { chunkIndex: 0, sentenceIndex: 0 };
    },
  };
}
