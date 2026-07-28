import { splitIntoSentences } from './chunkText';

// edge-tts word boundary offsets/durations are in 100-nanosecond units.
const TICKS_PER_SECOND = 10_000_000;

// Word boundary text never carries whitespace or punctuation, only spoken content -
// strip both from a sentence before comparing its length against accumulated word text,
// so trailing punctuation (already part of the sentence per chunkText's splitting rule)
// doesn't block the match.
const NON_CONTENT_PATTERN = /[\s。！？，、；：""''「」『』（）()\[\]【】〈〉《》…—-]/g;

function contentLength(value) {
  return value.replace(NON_CONTENT_PATTERN, '').length;
}

function ticksToSeconds(ticks) {
  return ticks / TICKS_PER_SECOND;
}

// Given a chunk's raw text and its word-level TTS boundaries, derives ordered
// sentence-level time spans: a pure function of (text, boundaries) with no dependency
// on playback state. Re-splits the text the same way chunkText does internally, then
// greedily walks the word boundaries assigning consecutive words to each sentence until
// their combined content length reaches that sentence's own content length. A sentence
// left with no words (e.g. punctuation-only, or boundaries running out early due to TTS
// normalization drift) collapses to a zero-length span at the previous sentence's end.
export function deriveSentenceSpans({ text, boundaries }) {
  const sentences = splitIntoSentences(text);
  const spans = [];
  let wordIndex = 0;

  for (const sentence of sentences) {
    const targetLength = contentLength(sentence);
    const startWordIndex = wordIndex;
    let consumedLength = 0;

    while (wordIndex < boundaries.length && consumedLength < targetLength) {
      consumedLength += contentLength(boundaries[wordIndex].text);
      wordIndex += 1;
    }

    const sentenceWords = boundaries.slice(startWordIndex, wordIndex);
    if (sentenceWords.length === 0) {
      const fallback = spans.at(-1)?.endSeconds ?? 0;
      spans.push({ text: sentence, startSeconds: fallback, endSeconds: fallback });
      continue;
    }

    const firstWord = sentenceWords[0];
    const lastWord = sentenceWords.at(-1);
    spans.push({
      text: sentence,
      startSeconds: ticksToSeconds(firstWord.offset),
      endSeconds: ticksToSeconds(lastWord.offset + lastWord.duration),
    });
  }

  return spans;
}
