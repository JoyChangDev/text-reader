import { isPlayableChunk } from './chunkAudio';
import { splitIntoSentences } from './chunkText';

// Builds what the client needs to turn a Book into metadata cues on the continuous HLS
// timeline — see .scratch/phase-1-10-continuous-hls-playback/issues/03-playlist-and-manifest-routes.md.
// Pure: the route supplies the Chunk text and the stored per-Chunk metadata.

// Spans arrive already derived — from the Chunk index, which stored them at generation
// time, or from bookAudio deriving them on the Blob fallback. Deriving them here instead
// meant walking every word boundary of every placed Chunk on every request, which was most
// of the 4.7s the manifest route spent in application code on a 2,000-Chunk Book (ticket 08).
//
// Spans are Chunk-relative; this is the only place they are shifted onto the Book timeline
// and given Book-global ordinals, so a cue identifies a Sentence without reference to any
// Chunk.
function toSentenceCues(spans, { startSeconds, firstSentenceId }) {
  return spans.map((span, index) => ({
    id: firstSentenceId + index,
    startSeconds: startSeconds + span.startSeconds,
    endSeconds: startSeconds + span.endSeconds,
  }));
}

// One entry per Chunk of the Book, in order. A Chunk is on the timeline only while every
// Chunk between the start and it is too: the playlist truncates at its first gap, so a
// Chunk past that gap has no knowable startSeconds however complete its own audio is.
// Sentence ordinals, by contrast, are counted from the Chunk text rather than from what
// happens to be generated, so a Sentence keeps the same id as the Book fills in around it.
//
// `from` is the Chunk the playlist being described starts at, which the Listener sets by
// seeking past a stretch the playlist can't reach (see ticket 07). It moves where the
// timeline's zero is and nothing else: Chunks before it are still reported, so the client
// can see what is generated across the whole Book, but they are off this timeline and
// contribute no time to it. Sentence ids are deliberately untouched by it - a Sentence's
// identity can't depend on where the Book happens to be played from.
export function buildBookManifest({ chunks, chunkAudio }, { from = 0 } = {}) {
  let startSeconds = 0;
  let firstSentenceId = 0;
  let onTimeline = true;

  const manifestChunks = chunks.map((text, index) => {
    const metadata = chunkAudio[index];
    // isGenerated is the playlist's rule, not merely "has a metadata blob": a Chunk the
    // playlist can't place is one the client should still request, which is what repairs
    // a Chunk cached before durationSeconds existed (see ticket 02).
    const isGenerated = isPlayableChunk(metadata);
    const placeable = index >= from && onTimeline && isGenerated;

    const entry = {
      index,
      isGenerated,
      startSeconds: placeable ? startSeconds : null,
      sentences: placeable
        ? toSentenceCues(metadata.spans ?? [], { startSeconds, firstSentenceId })
        : [],
    };

    // Counted over every Chunk, including the ones before the start: an ordinal is a
    // position in the Book, not in the stretch being played.
    firstSentenceId += splitIntoSentences(text).length;

    if (placeable) {
      startSeconds += metadata.durationSeconds;
    } else if (index >= from) {
      // Only a gap the playlist actually reaches ends the timeline. One the Listener
      // jumped over is behind the start and says nothing about what follows it.
      onTimeline = false;
    }

    return entry;
  });

  return { chunks: manifestChunks };
}
