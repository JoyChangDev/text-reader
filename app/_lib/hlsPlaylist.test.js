import { describe, expect, test } from 'vitest';

import { buildEventPlaylist, toPlaylistSegments } from './hlsPlaylist';

const segment = (index, durationSeconds) => ({
  url: `https://blob.example/book-1/${index}/voice.mp3`,
  durationSeconds,
});

function lines(playlist) {
  return playlist.trimEnd().split('\n');
}

describe('buildEventPlaylist', () => {
  test('emits the EVENT header tags before any segment', () => {
    const playlist = buildEventPlaylist([segment(0, 5), segment(1, 4)]);

    expect(lines(playlist).slice(0, 5)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-MEDIA-SEQUENCE:0',
    ]);
  });

  test('emits one #EXTINF and absolute URL per segment, and #EXT-X-ENDLIST, for a fully-generated book', () => {
    const playlist = buildEventPlaylist([segment(0, 5.12), segment(1, 3.5)]);

    expect(lines(playlist).slice(5)).toEqual([
      '#EXTINF:5.120,',
      'https://blob.example/book-1/0/voice.mp3',
      '#EXTINF:3.500,',
      'https://blob.example/book-1/1/voice.mp3',
      '#EXT-X-ENDLIST',
    ]);
  });

  // The absence of #EXT-X-ENDLIST is what tells the media stack to re-fetch the playlist
  // as more Chunks generate - a partially-generated Book must never look complete.
  test('omits #EXT-X-ENDLIST while any Chunk is still ungenerated', () => {
    const playlist = buildEventPlaylist([segment(0, 5), segment(1, 4), null]);

    expect(playlist).not.toContain('#EXT-X-ENDLIST');
    expect(playlist).toContain('https://blob.example/book-1/1/voice.mp3');
  });

  // Skipping the gap would splice Chunk N+2 onto Chunk N and narrate the Book out of order.
  test('stops at the first ungenerated Chunk rather than skipping it', () => {
    const playlist = buildEventPlaylist([segment(0, 5), null, segment(2, 4)]);

    expect(lines(playlist).slice(5)).toEqual([
      '#EXTINF:5.000,',
      'https://blob.example/book-1/0/voice.mp3',
    ]);
    expect(playlist).not.toContain('https://blob.example/book-1/2/voice.mp3');
  });

  // A Listener who jumps past a stretch the playlist can't reach gets a playlist that
  // starts where they landed (see ticket 07) - the Chunks they skipped stay ungenerated,
  // and must not truncate the stream they are now listening to.
  describe('starting from a Chunk other than the first', () => {
    test('omits every Chunk before the start', () => {
      const playlist = buildEventPlaylist([segment(0, 5), segment(1, 4), segment(2, 3)], {
        from: 1,
      });

      expect(lines(playlist).slice(5)).toEqual([
        '#EXTINF:4.000,',
        'https://blob.example/book-1/1/voice.mp3',
        '#EXTINF:3.000,',
        'https://blob.example/book-1/2/voice.mp3',
        '#EXT-X-ENDLIST',
      ]);
    });

    test('is unaffected by a gap before the start', () => {
      const playlist = buildEventPlaylist([null, segment(1, 4), segment(2, 3)], { from: 1 });

      expect(playlist).toContain('https://blob.example/book-1/1/voice.mp3');
      expect(playlist).toContain('https://blob.example/book-1/2/voice.mp3');
      expect(playlist).toContain('#EXT-X-ENDLIST');
    });

    test('still stops at the first gap at or after the start', () => {
      const playlist = buildEventPlaylist([null, segment(1, 4), null, segment(3, 3)], { from: 1 });

      expect(lines(playlist).slice(5)).toEqual([
        '#EXTINF:4.000,',
        'https://blob.example/book-1/1/voice.mp3',
      ]);
      expect(playlist).not.toContain('#EXT-X-ENDLIST');
    });

    test('ignores segments before the start when computing the target duration', () => {
      const playlist = buildEventPlaylist([segment(0, 30), segment(1, 4)], { from: 1 });

      expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
    });
  });

  test('targets the ceiling of the longest included segment when durations are unequal', () => {
    const playlist = buildEventPlaylist([segment(0, 3.2), segment(1, 9.4), segment(2, 1.75)]);

    expect(playlist).toContain('#EXT-X-TARGETDURATION:10');
  });

  // A Chunk after the gap is longer than every included one, and must not raise the target.
  test('ignores segments past the gap when computing the target duration', () => {
    const playlist = buildEventPlaylist([segment(0, 3.2), null, segment(2, 30)]);

    expect(playlist).toContain('#EXT-X-TARGETDURATION:4');
  });

  // A Book whose first Chunk hasn't finished generating still has to serve a parseable
  // playlist - the client points <audio> at this URL before any audio exists. The target
  // duration is a client's reload interval, so it floors at a second rather than at zero.
  test('returns a valid, segment-free playlist for a Book with nothing generated yet', () => {
    const playlist = buildEventPlaylist([null, null]);

    expect(lines(playlist)).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:1',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-MEDIA-SEQUENCE:0',
    ]);
  });

  test('ends with a newline so the last line is a complete playlist line', () => {
    expect(buildEventPlaylist([segment(0, 5)])).toMatch(/\n$/);
  });
});

describe('toPlaylistSegments', () => {
  test('maps stored Chunk metadata to segments in index order', () => {
    const segments = toPlaylistSegments([
      { url: 'https://blob.example/0.mp3', durationSeconds: 5, boundaries: [] },
      { url: 'https://blob.example/1.mp3', durationSeconds: 4, boundaries: [] },
    ]);

    expect(segments).toEqual([
      { url: 'https://blob.example/0.mp3', durationSeconds: 5 },
      { url: 'https://blob.example/1.mp3', durationSeconds: 4 },
    ]);
  });

  test('treats an ungenerated Chunk as a gap', () => {
    expect(toPlaylistSegments([undefined])).toEqual([null]);
  });

  // A Chunk cached before durationSeconds existed can't be placed on the timeline;
  // audioGenerationService repairs it when generation next touches it (see ticket 02).
  test('treats a Chunk with no usable duration as a gap', () => {
    const segments = toPlaylistSegments([
      { url: 'https://blob.example/0.mp3', boundaries: [] },
      { url: 'https://blob.example/1.mp3', durationSeconds: 0, boundaries: [] },
    ]);

    expect(segments).toEqual([null, null]);
  });
});
