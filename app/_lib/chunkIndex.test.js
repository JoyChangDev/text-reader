import { describe, expect, test } from 'vitest';

import { deriveSegmentUrl, readIndexedRun } from './chunkIndex';

// The base is the configured segment origin - the Worker's - rather than one recovered from
// a write response, which is what storeBase used to do before ticket 04 of phase 1.11.
const SEGMENT_ORIGIN = 'https://leia.text-reader.workers.dev/';

describe('deriveSegmentUrl', () => {
  test('rebuilds the segment URL from the configured origin and the cache key', () => {
    expect(
      deriveSegmentUrl(SEGMENT_ORIGIN, {
        bookId: 'book-1',
        chunkIndex: 7,
        voice: 'voice-a',
      }),
    ).toBe('https://leia.text-reader.workers.dev/book-1/7/voice-a.mp3');
  });
});

describe('readIndexedRun', () => {
  const base = SEGMENT_ORIGIN;
  const book = { bookId: 'book-1', voice: 'voice-a', chunkCount: 5 };

  test('returns one entry per Chunk index, undefined where not indexed', () => {
    const run = readIndexedRun({ base, durations: { 0: '12.5', 1: '11.25' } }, book);

    expect(run).toHaveLength(5);
    expect(run[0]).toEqual({
      url: `${base}book-1/0/voice-a.mp3`,
      durationSeconds: 12.5,
    });
    expect(run[2]).toBeUndefined();
  });

  // The client returns hash values as strings from HGETALL and as numbers from HMGET, so
  // the coercion has to be explicit - a string reaching the playlist becomes #EXTINF:"12.5".
  test('coerces durations to numbers whichever way the client returned them', () => {
    const run = readIndexedRun({ base, durations: { 0: '12.5', 1: 11.25 } }, book);

    expect(run[0].durationSeconds).toBe(12.5);
    expect(run[1].durationSeconds).toBe(11.25);
  });

  // It used to stop here, on the reasoning that the playlist truncates at a gap anyway. True
  // of the playlist and false of the manifest, which reports isGenerated for the whole Book -
  // so a narrated Chunk past a gap read as never narrated, and no seek could ever be told it
  // existed (ticket 17). The playlist is unaffected: buildEventPlaylist does its own
  // truncation on the first null.
  test('reports Chunks past a gap, leaving the truncation to the playlist', () => {
    const run = readIndexedRun({ base, durations: { 0: '12', 1: '12', 3: '12' } }, book);

    expect(run[1]).toBeDefined();
    expect(run[2]).toBeUndefined();
    expect(run[3]).toBeDefined();
  });

  // `from` decides where the timeline begins, not what counts as narrated. Ticket 07 always
  // said Chunks before the start report their real isGenerated - the client needs it, because
  // a backward seek to a Chunk before the playlist's start is unreachable by definition and can
  // only be re-pointed to if the client is told it exists. The code did not do it until
  // ticket 17; buildEventPlaylist is what ignores everything before `from`.
  test('reports the whole Book, including Chunks before the playlist would start', () => {
    const run = readIndexedRun({ base, durations: { 0: '12', 3: '12', 4: '12' } }, book);

    expect(run[3]).toBeDefined();
    expect(run[4]).toBeDefined();
    expect(run[0]).toBeDefined();
    expect(run[1]).toBeUndefined();
  });

  // A value that can't be a duration is treated as absent wherever it sits. It used to be a
  // miss at `from` specifically, meaning "ask Blob" - but since ticket 17 removed the Blob
  // scan, a miss means "Redis said nothing", and a Book that is merely narrated somewhere
  // other than its start must not be able to say that. Upload a Book, seek far before playing
  // from the beginning, and ticket 15 narrates the target alone: Chunk 0 stays empty forever.
  test('is still a run when the Chunk at `from` has a non-numeric or zero duration', () => {
    const nonsense = readIndexedRun({ base, durations: { 0: 'nonsense', 1: '12' } }, book);
    expect(nonsense[0]).toBeUndefined();
    expect(nonsense[1]).toBeDefined();

    const zero = readIndexedRun({ base, durations: { 0: '0', 1: '12' } }, book);
    expect(zero[0]).toBeUndefined();
    expect(zero[1]).toBeDefined();
  });

  test('treats a non-numeric or zero duration mid-run as an ungenerated Chunk', () => {
    const run = readIndexedRun({ base, durations: { 0: '12', 1: '0', 2: '12' } }, book);

    expect(run[0]).toBeDefined();
    expect(run[1]).toBeUndefined();
    expect(run[2]).toBeDefined();
  });

  test('is a miss when the store base was never recorded', () => {
    expect(readIndexedRun({ base: null, durations: { 0: '12' } }, book)).toBeUndefined();
  });

  // The two halves of the distinction ticket 17 rests on. An empty hash is Redis answering
  // about a Book nobody has narrated; a missing hash is Redis not answering. With no Blob
  // scan behind them the routes serve an empty playlist for one and a 502 for the other, so
  // collapsing them would report an outage as a Book that simply has no audio.
  test('is a run of nothing when the index is empty, which is not the same as a miss', () => {
    const run = readIndexedRun({ base, durations: {} }, book);

    expect(run).toHaveLength(5);
    expect(run.every((entry) => entry === undefined)).toBe(true);
  });

  test('is a miss when there is no durations hash at all', () => {
    expect(readIndexedRun({ base, durations: null }, book)).toBeUndefined();
  });
});
