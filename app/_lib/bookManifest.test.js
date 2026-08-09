import { describe, expect, test } from 'vitest';

import { buildBookManifest } from './bookManifest';

const TWO_SENTENCE_TEXT = '你好。世界。';

// Already derived: the manifest takes Chunk-relative spans, not raw word boundaries. They
// are derived once at generation time and stored in the Chunk index, or by bookAudio on the
// Blob fallback - see ticket 08's stage 2.
const twoSentenceSpans = [
  { startSeconds: 0, endSeconds: 1 },
  { startSeconds: 2, endSeconds: 3 },
];

// One span per Sentence, all at zero: enough to pin how many cues a Chunk contributes and
// what they are numbered, for the tests that are about ordinals rather than times.
const emptySpans = (count) =>
  Array.from({ length: count }, () => ({ startSeconds: 0, endSeconds: 0 }));

function generated(durationSeconds, { index = 0 } = {}) {
  return {
    url: `https://blob.example/book-1/${index}/voice.mp3`,
    spans: twoSentenceSpans,
    durationSeconds,
  };
}

describe('buildBookManifest', () => {
  // The whole point of the manifest: cue times live on one continuous Book timeline,
  // so each Chunk starts where the sum of every prior Chunk's audio ends.
  test('accumulates startSeconds over Chunks of deliberately unequal durations', () => {
    const chunks = [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT];
    const chunkAudio = [generated(7.5), generated(3.25, { index: 1 }), generated(11, { index: 2 })];

    const manifest = buildBookManifest({ chunks, chunkAudio });

    expect(manifest.chunks.map((chunk) => chunk.startSeconds)).toEqual([0, 7.5, 10.75]);
  });

  test('reports each Chunk index and whether it is generated', () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [generated(5), undefined],
    });

    expect(manifest.chunks.map(({ index, isGenerated }) => ({ index, isGenerated }))).toEqual([
      { index: 0, isGenerated: true },
      { index: 1, isGenerated: false },
    ]);
  });

  // deriveSentenceSpans is called with the Chunk's stored boundaries and returns
  // Chunk-relative times; the manifest is what shifts them onto the Book timeline.
  test("offsets each Chunk's derived Sentence spans by its startSeconds", () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [generated(7.5), generated(4, { index: 1 })],
    });

    expect(manifest.chunks[0].sentences).toEqual([
      { id: 0, startSeconds: 0, endSeconds: 1 },
      { id: 1, startSeconds: 2, endSeconds: 3 },
    ]);
    expect(manifest.chunks[1].sentences).toEqual([
      { id: 2, startSeconds: 7.5, endSeconds: 8.5 },
      { id: 3, startSeconds: 9.5, endSeconds: 10.5 },
    ]);
  });

  // A cue identifies a Sentence without reference to any Chunk, so ids are Book-global
  // ordinals: every Sentence in every prior Chunk, plus the index within this one.
  test('numbers Sentences with Book-global ordinals that ignore Chunk boundaries', () => {
    const manifest = buildBookManifest({
      chunks: ['一。二。三。', '四。', '五。六。'],
      chunkAudio: [
        { url: 'a', durationSeconds: 3, spans: emptySpans(3) },
        { url: 'b', durationSeconds: 1, spans: emptySpans(1) },
        { url: 'c', durationSeconds: 2, spans: emptySpans(2) },
      ],
    });

    expect(manifest.chunks.map((chunk) => chunk.sentences.map((sentence) => sentence.id))).toEqual([
      [0, 1, 2],
      [3],
      [4, 5],
    ]);
  });

  // Ordinals are counted from the Chunk text, not from what happens to be generated, so
  // a Sentence keeps the same id however much of the Book around it is narrated yet.
  test('keeps ordinals stable as the Chunks around a Sentence generate', () => {
    const chunks = ['一。二。', '三。四。', '五。六。'];
    const audio = (index) => ({ url: `${index}`, durationSeconds: 2, spans: emptySpans(2) });

    const complete = buildBookManifest({ chunks, chunkAudio: [audio(0), audio(1), audio(2)] });
    const partial = buildBookManifest({ chunks, chunkAudio: [audio(0), audio(1), undefined] });

    expect(complete.chunks[1].sentences.map((sentence) => sentence.id)).toEqual([2, 3]);
    expect(partial.chunks[1].sentences).toEqual(complete.chunks[1].sentences);
  });

  test('gives an ungenerated Chunk no place on the timeline and no Sentence spans', () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [generated(5), undefined],
    });

    expect(manifest.chunks[1]).toEqual({
      index: 1,
      isGenerated: false,
      startSeconds: null,
      sentences: [],
    });
  });

  // The playlist truncates at the first gap, so a Chunk past it isn't on the timeline
  // yet however complete its own audio is - its startSeconds isn't knowable.
  test('leaves a generated Chunk past a gap off the timeline', () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [generated(5), undefined, generated(4, { index: 2 })],
    });

    expect(manifest.chunks[2]).toMatchObject({
      index: 2,
      isGenerated: true,
      startSeconds: null,
      sentences: [],
    });
  });

  // Same rule the playlist applies: a Chunk cached before durationSeconds existed can't be
  // placed, and nothing after it can be either. It is reported ungenerated so the client
  // requests it again, which is what repairs the stored metadata (see ticket 02).
  test('reports a Chunk with no usable duration as not generated', () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [{ url: 'a', spans: twoSentenceSpans }, generated(4, { index: 1 })],
    });

    expect(manifest.chunks[0]).toEqual({
      index: 0,
      isGenerated: false,
      startSeconds: null,
      sentences: [],
    });
    expect(manifest.chunks[1].startSeconds).toBeNull();
  });

  // A Book is opened before any of it has been narrated; that's an empty manifest,
  // not an error.
  test('returns an entry per Chunk, with no Sentence spans, for a Book with nothing generated', () => {
    const manifest = buildBookManifest({
      chunks: [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT],
      chunkAudio: [undefined, undefined],
    });

    expect(manifest.chunks).toEqual([
      { index: 0, isGenerated: false, startSeconds: null, sentences: [] },
      { index: 1, isGenerated: false, startSeconds: null, sentences: [] },
    ]);
  });

  test('returns no Chunks for a Book with no text', () => {
    expect(buildBookManifest({ chunks: [], chunkAudio: [] })).toEqual({ chunks: [] });
  });

  // A Book can be played from part-way in, when the Listener jumps past a stretch that
  // was never narrated and the playlist therefore can't reach (see ticket 07). The
  // timeline the element plays starts at that Chunk, so the cue times have to as well.
  describe('starting from a Chunk other than the first', () => {
    const threeChunks = [TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT, TWO_SENTENCE_TEXT];
    const threeGenerated = [generated(7.5), generated(4, { index: 1 }), generated(5, { index: 2 })];

    test('places the start Chunk at zero and accumulates from there', () => {
      const manifest = buildBookManifest(
        { chunks: threeChunks, chunkAudio: threeGenerated },
        { from: 1 },
      );

      expect(manifest.chunks.map(({ startSeconds }) => startSeconds)).toEqual([null, 0, 4]);
    });

    test('rebases Sentence times onto the same zero', () => {
      const manifest = buildBookManifest(
        { chunks: threeChunks, chunkAudio: threeGenerated },
        { from: 1 },
      );

      expect(manifest.chunks[1].sentences).toEqual([
        { id: 2, startSeconds: 0, endSeconds: 1 },
        { id: 3, startSeconds: 2, endSeconds: 3 },
      ]);
    });

    // The identity of a Sentence can't depend on where the Book happens to be played
    // from, or the reading position and the stored resume format would not survive a
    // re-point.
    test('leaves Sentence ids unchanged', () => {
      const fromStart = buildBookManifest({ chunks: threeChunks, chunkAudio: threeGenerated });
      const fromMiddle = buildBookManifest(
        { chunks: threeChunks, chunkAudio: threeGenerated },
        { from: 1 },
      );

      expect(fromMiddle.chunks[2].sentences.map(({ id }) => id)).toEqual([4, 5]);
      expect(fromMiddle.chunks[2].sentences.map(({ id }) => id)).toEqual(
        fromStart.chunks[2].sentences.map(({ id }) => id),
      );
    });

    // They are still reported - the client reads isGenerated across the whole Book to
    // decide whether a seek target is reachable without re-pointing at all.
    test('reports Chunks before the start as generated but off this timeline', () => {
      const manifest = buildBookManifest(
        { chunks: threeChunks, chunkAudio: threeGenerated },
        { from: 1 },
      );

      expect(manifest.chunks[0]).toEqual({
        index: 0,
        isGenerated: true,
        startSeconds: null,
        sentences: [],
      });
    });

    // The point of starting here: an ungenerated Chunk before the start is exactly what
    // the Listener jumped over, and it must not truncate the timeline they land on.
    test('is unaffected by a gap before the start Chunk', () => {
      const manifest = buildBookManifest(
        { chunks: threeChunks, chunkAudio: [undefined, generated(4, { index: 1 }), generated(5)] },
        { from: 1 },
      );

      expect(manifest.chunks.map(({ startSeconds }) => startSeconds)).toEqual([null, 0, 4]);
    });

    test('still truncates at the first gap at or after the start Chunk', () => {
      const manifest = buildBookManifest(
        {
          chunks: threeChunks,
          chunkAudio: [generated(7.5), undefined, generated(5, { index: 2 })],
        },
        { from: 1 },
      );

      expect(manifest.chunks.map(({ startSeconds }) => startSeconds)).toEqual([null, null, null]);
    });

    test('past the end of the Book yields no timeline at all', () => {
      const manifest = buildBookManifest(
        { chunks: threeChunks, chunkAudio: threeGenerated },
        { from: 9 },
      );

      expect(manifest.chunks.every(({ startSeconds }) => startSeconds === null)).toBe(true);
      expect(manifest.chunks).toHaveLength(3);
    });
  });
});
