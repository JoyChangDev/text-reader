import { isPlayableChunk } from './chunkAudio';
import { splitIntoSentences } from './chunkText';
import { deriveSentenceSpans } from './sentenceSpans';

// Builds what the client needs to turn a Book into metadata cues on the continuous HLS
// timeline — see .scratch/phase-1-10-continuous-hls-playback/issues/03-playlist-and-manifest-routes.md.
// Pure: the route supplies the Chunk text and the stored per-Chunk metadata.

// deriveSentenceSpans works in Chunk-relative time and knows nothing about the Book it
// sits in; this is the only place its output is shifted onto the Book timeline and given
// Book-global ordinals, so a cue identifies a Sentence without reference to any Chunk.
function toSentenceCues({ text, boundaries }, { startSeconds, firstSentenceId }) {
  return deriveSentenceSpans({ text, boundaries }).map((span, index) => ({
    id: firstSentenceId + index,
    startSeconds: startSeconds + span.startSeconds,
    endSeconds: startSeconds + span.endSeconds,
  }));
}

// One entry per Chunk of the Book, in order. A Chunk is on the timeline only while every
// Chunk before it is too: the playlist truncates at the first gap, so a Chunk past that
// gap has no knowable startSeconds however complete its own audio is. Sentence ordinals,
// by contrast, are counted from the Chunk text rather than from what happens to be
// generated, so a Sentence keeps the same id as the Book fills in around it.
export function buildBookManifest({ chunks, chunkAudio }) {
  let startSeconds = 0;
  let firstSentenceId = 0;
  let onTimeline = true;

  const manifestChunks = chunks.map((text, index) => {
    const metadata = chunkAudio[index];
    // isGenerated is the playlist's rule, not merely "has a metadata blob": a Chunk the
    // playlist can't place is one the client should still request, which is what repairs
    // a Chunk cached before durationSeconds existed (see ticket 02).
    const isGenerated = isPlayableChunk(metadata);
    const placeable = onTimeline && isGenerated;

    const entry = {
      index,
      isGenerated,
      startSeconds: placeable ? startSeconds : null,
      sentences: placeable
        ? toSentenceCues(
            { text, boundaries: metadata.boundaries ?? [] },
            { startSeconds, firstSentenceId },
          )
        : [],
    };

    firstSentenceId += splitIntoSentences(text).length;
    if (placeable) {
      startSeconds += metadata.durationSeconds;
    } else {
      onTimeline = false;
    }

    return entry;
  });

  return { chunks: manifestChunks };
}
