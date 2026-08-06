import { describe, expect, test } from 'vitest';

import { parsePlaylistStart } from './playlistStart';

describe('parsePlaylistStart', () => {
  test('defaults to the beginning of the Book when absent', () => {
    expect(parsePlaylistStart(null, { chunkCount: 5 })).toEqual({ from: 0 });
  });

  test('reads a Chunk index inside the Book', () => {
    expect(parsePlaylistStart('3', { chunkCount: 5 })).toEqual({ from: 3 });
  });

  test('accepts the last Chunk', () => {
    expect(parsePlaylistStart('4', { chunkCount: 5 })).toEqual({ from: 4 });
  });

  // Serving an empty playlist for these would look to the media stack like a Book with
  // nothing generated, which is a very different thing from a request that makes no
  // sense. The client derives `from` from its own Chunk list, so any of these is a bug
  // worth failing loudly on.
  describe('rejecting a start that names no Chunk', () => {
    test.each([
      ['past the end of the Book', '5'],
      ['negative', '-1'],
      ['not a number', 'middle'],
      ['fractional', '1.5'],
      ['empty', ''],
    ])('%s', (unused, value) => {
      expect(parsePlaylistStart(value, { chunkCount: 5 })).toEqual({
        error: 'from must be a Chunk index in this Book',
      });
    });
  });

  test('rejects any start at all for a Book with no Chunks', () => {
    expect(parsePlaylistStart('0', { chunkCount: 0 })).toEqual({
      error: 'from must be a Chunk index in this Book',
    });
    expect(parsePlaylistStart(null, { chunkCount: 0 })).toEqual({ from: 0 });
  });
});
