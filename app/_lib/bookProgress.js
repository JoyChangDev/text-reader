import { splitIntoSentences } from './chunkText';
import { deriveSentenceSpans, ticksToSeconds } from './sentenceSpans';

// Rough default used only before any chunk has been generated for the current voice -
// once at least one has, computeSecondsPerChar's observed ratio takes over (see ticket 08).
export const DEFAULT_SECONDS_PER_CHAR = 0.2;

// Pure duration-estimation function: chunk character count + an observed (or default)
// seconds-per-character ratio -> estimated duration in seconds.
export function estimateChunkDuration(characterCount, secondsPerChar) {
  return characterCount * secondsPerChar;
}

// A chunk's real duration once generated: the end of its last word boundary, converted
// from edge-tts's 100-nanosecond ticks to seconds.
export function chunkDurationFromBoundaries(boundaries) {
  if (!boundaries || boundaries.length === 0) return 0;
  const lastWord = boundaries.at(-1);
  return ticksToSeconds(lastWord.offset + lastWord.duration);
}

// Observed duration/characterCount ratio across already-generated chunks for the given
// voice - chunks generated under a previous voice selection keep playing as-is but are
// excluded here (see ticket 02's prospective-only voice change), so a voice switch
// doesn't blend a different voice's pacing into estimates for the new one. Returns null
// until at least one chunk has been generated for this voice, so callers fall back to
// DEFAULT_SECONDS_PER_CHAR.
export function computeSecondsPerChar({ chunks, chunkAudio, voice }) {
  let totalChars = 0;
  let totalSeconds = 0;

  Object.entries(chunkAudio).forEach(([indexKey, entry]) => {
    if (entry?.status !== 'ready' || !entry.boundaries?.length) return;
    if (entry.voice !== voice) return;

    const charCount = chunks[Number(indexKey)]?.length ?? 0;
    if (charCount === 0) return;

    totalChars += charCount;
    totalSeconds += chunkDurationFromBoundaries(entry.boundaries);
  });

  return totalChars > 0 ? totalSeconds / totalChars : null;
}

// The whole book's chunk-by-chunk timeline: each chunk's real duration once generated,
// or its estimated duration otherwise, laid end to end. Recalculates fresh from (chunks,
// chunkAudio) whenever either changes - not persisted, so a chunk finishing generation
// naturally replaces its estimate with its real duration on the next render (see ticket 08).
// A chunk already generated under a previous voice still contributes its own real,
// already-known duration to the timeline (it's what will actually play) even though it's
// excluded from the ratio above.
export function buildBookTimeline({ chunks, chunkAudio, voice }) {
  const secondsPerChar =
    computeSecondsPerChar({ chunks, chunkAudio, voice }) ?? DEFAULT_SECONDS_PER_CHAR;
  let cursor = 0;

  const segments = chunks.map((text, chunkIndex) => {
    const entry = chunkAudio[chunkIndex];
    const hasRealDuration = entry?.status === 'ready' && entry.boundaries?.length > 0;
    const durationSeconds = hasRealDuration
      ? chunkDurationFromBoundaries(entry.boundaries)
      : estimateChunkDuration(text.length, secondsPerChar);

    const startSeconds = cursor;
    cursor += durationSeconds;

    return {
      chunkIndex,
      startSeconds,
      endSeconds: cursor,
      durationSeconds,
      isEstimated: !hasRealDuration,
    };
  });

  return { segments, totalSeconds: cursor };
}

// Maps a book-level scrub target (seconds from the start of the whole book) to the chunk
// it falls in and the offset within that chunk - clamped to the book's actual span so a
// drag past either end still resolves to a valid target.
export function locateBookOffset(segments, targetSeconds) {
  if (segments.length === 0) return null;

  const total = segments.at(-1).endSeconds;
  const clamped = Math.min(Math.max(targetSeconds, 0), total);
  const segment = segments.find((candidate) => clamped < candidate.endSeconds) ?? segments.at(-1);

  return { chunkIndex: segment.chunkIndex, offsetSeconds: clamped - segment.startSeconds };
}

// Maps an offset within a single chunk to the sentence index it falls in, so a scrub
// target can be handed to the same seekToSentence entry point ticket 01 already tests
// (see useBookPlayer.js). A generated chunk reuses deriveSentenceSpans directly; a
// not-yet-generated one has no real timing yet, so its sentences are distributed
// proportionally by character length over the chunk's estimated duration instead.
export function locateSentenceIndexForOffset({
  text,
  boundaries,
  offsetSeconds,
  chunkDurationSeconds,
}) {
  if (boundaries && boundaries.length > 0) {
    const spans = deriveSentenceSpans({ text, boundaries });
    if (spans.length === 0) return 0;

    const index = spans.findIndex(
      (span) => offsetSeconds >= span.startSeconds && offsetSeconds < span.endSeconds,
    );
    if (index !== -1) return index;
    return offsetSeconds >= spans.at(-1).endSeconds ? spans.length - 1 : 0;
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return 0;

  const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
  const targetFraction = chunkDurationSeconds > 0 ? offsetSeconds / chunkDurationSeconds : 0;

  let cumulativeChars = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    cumulativeChars += sentences[index].length;
    if (targetFraction <= cumulativeChars / totalChars) return index;
  }

  return sentences.length - 1;
}
