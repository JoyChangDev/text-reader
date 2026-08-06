import { describe, expect, test } from 'vitest';

import { buildBookManifest } from './bookManifest';
import { sentenceOrdinals } from './sentenceOrdinals';

describe('sentenceOrdinals', () => {
  const chunks = ['第一句。第二句。', '第三句。', '第四句。第五句。第六句。'];

  test('counts every Sentence in the Book, generated or not', () => {
    expect(sentenceOrdinals(chunks).total).toBe(6);
  });

  test('numbers Sentences continuously across Chunk boundaries', () => {
    const { toOrdinal } = sentenceOrdinals(chunks);

    expect(toOrdinal(0, 0)).toBe(0);
    expect(toOrdinal(0, 1)).toBe(1);
    expect(toOrdinal(1, 0)).toBe(2);
    expect(toOrdinal(2, 0)).toBe(3);
    expect(toOrdinal(2, 2)).toBe(5);
  });

  test('maps an ordinal back to the Chunk and the Sentence within it', () => {
    const { toChunkPosition } = sentenceOrdinals(chunks);

    expect(toChunkPosition(0)).toEqual({ chunkIndex: 0, sentenceIndex: 0 });
    expect(toChunkPosition(1)).toEqual({ chunkIndex: 0, sentenceIndex: 1 });
    expect(toChunkPosition(2)).toEqual({ chunkIndex: 1, sentenceIndex: 0 });
    expect(toChunkPosition(3)).toEqual({ chunkIndex: 2, sentenceIndex: 0 });
    expect(toChunkPosition(5)).toEqual({ chunkIndex: 2, sentenceIndex: 2 });
  });

  test('round-trips every position in the Book', () => {
    const { toOrdinal, toChunkPosition, total } = sentenceOrdinals(chunks);

    for (let ordinal = 0; ordinal < total; ordinal += 1) {
      const { chunkIndex, sentenceIndex } = toChunkPosition(ordinal);
      expect(toOrdinal(chunkIndex, sentenceIndex)).toBe(ordinal);
    }
  });

  // A saved position can outlive the Book it was saved against - a re-upload can
  // re-chunk the same text into fewer Sentences. Clamping keeps that resolving to a real
  // Sentence rather than highlighting nothing and persisting an off-the-end position.
  describe('clamping out-of-range input', () => {
    test('an ordinal past the end resolves to the last Sentence', () => {
      expect(sentenceOrdinals(chunks).toChunkPosition(99)).toEqual({
        chunkIndex: 2,
        sentenceIndex: 2,
      });
    });

    test('a negative ordinal resolves to the first Sentence', () => {
      expect(sentenceOrdinals(chunks).toChunkPosition(-1)).toEqual({
        chunkIndex: 0,
        sentenceIndex: 0,
      });
    });

    test('a position past the end clamps into the Book', () => {
      const { toOrdinal } = sentenceOrdinals(chunks);

      // Each half clamps on its own rather than collapsing to the end of the Book: a
      // stale Chunk pointer names the start of the last Chunk, which is nearer where the
      // Listener actually was than the Book's final Sentence would be.
      expect(toOrdinal(9, 0)).toBe(3);
      expect(toOrdinal(2, 9)).toBe(5);
      expect(toOrdinal(-1, -1)).toBe(0);
    });
  });

  // Chunk text arrives from chunkText.js, which never emits an empty Chunk - but a
  // Sentence-less Chunk must still not swallow an ordinal, or every Sentence after it
  // would shift by one against the manifest's own count.
  describe('Chunks with no Sentences', () => {
    const withEmpty = ['第一句。', '   ', '第二句。'];

    test('contribute no ordinals', () => {
      expect(sentenceOrdinals(withEmpty).total).toBe(2);
    });

    test('are skipped when mapping an ordinal back', () => {
      expect(sentenceOrdinals(withEmpty).toChunkPosition(1)).toEqual({
        chunkIndex: 2,
        sentenceIndex: 0,
      });
    });
  });

  // The client and the server number Sentences independently and have to: the client
  // numbers Sentences in Chunks that haven't generated (so it can seek into them), while
  // the server numbers them as it walks the Chunks it is placing on the timeline. A cue
  // id only names the same Sentence on both sides because both count with
  // splitIntoSentences. This is the guard against the two drifting apart.
  test('agrees with the ids buildBookManifest stamps on cues', () => {
    const second = 10_000_000;
    // One word boundary per Sentence, so every derived span resolves cleanly.
    const chunkAudio = chunks.map((text) => ({
      url: 'https://blob.test/chunk',
      durationSeconds: 10,
      boundaries: text
        .split('。')
        .filter(Boolean)
        .map((sentence, index) => ({
          text: sentence,
          offset: index * second,
          duration: second,
        })),
    }));

    const { toOrdinal } = sentenceOrdinals(chunks);
    const manifest = buildBookManifest({ chunks, chunkAudio });

    const cueIds = manifest.chunks.flatMap(({ index, sentences }) =>
      sentences.map(({ id }, sentenceIndex) => [id, toOrdinal(index, sentenceIndex)]),
    );
    expect(cueIds).toHaveLength(6);
    cueIds.forEach(([manifestId, ordinal]) => expect(manifestId).toBe(ordinal));
  });

  describe('a Book with no Sentences at all', () => {
    test('has no ordinals and resolves everything to the start', () => {
      const { total, toOrdinal, toChunkPosition } = sentenceOrdinals([]);

      expect(total).toBe(0);
      expect(toOrdinal(0, 0)).toBe(0);
      expect(toChunkPosition(0)).toEqual({ chunkIndex: 0, sentenceIndex: 0 });
    });
  });
});
