import { isPlayableChunk } from './chunkAudio';

// Builds the EVENT-type HLS playlist a Book is played from — see
// .scratch/phase-1-10-continuous-hls-playback/issues/03-playlist-and-manifest-routes.md.
// Pure text: the route supplies the Chunk metadata, this decides nothing about storage.

// Version 3 is the lowest that permits float #EXTINF durations, which measured Chunk
// durations always are (mp3Frames.js sums samples-per-frame / sample rate).
const PLAYLIST_VERSION = 3;

export function toPlaylistSegments(chunkAudio) {
  return chunkAudio.map((metadata) =>
    isPlayableChunk(metadata)
      ? { url: metadata.url, durationSeconds: metadata.durationSeconds }
      : null,
  );
}

// Takes one entry per Chunk in the Book, in order: { url, durationSeconds } for a
// generated Chunk, null for one that isn't generated yet. Playback truncates at the
// first gap rather than skipping it — a playlist listing Chunk N followed by Chunk N+2
// would narrate the Book out of order — and #EXT-X-ENDLIST is withheld until every
// Chunk is present, which is what makes the media stack re-fetch as the Book grows.
export function buildEventPlaylist(segments) {
  const gapIndex = segments.findIndex((segment) => !segment);
  const played = gapIndex === -1 ? segments : segments.slice(0, gapIndex);
  // RFC 8216 derives a client's playlist reload interval from the target duration, so an
  // empty playlist floors at one second rather than declaring 0 and inviting a tight
  // re-fetch loop on exactly the path a Book takes before its first Chunk exists.
  const targetDuration = Math.max(
    1,
    ...played.map(({ durationSeconds }) => Math.ceil(durationSeconds)),
  );

  const lines = [
    '#EXTM3U',
    `#EXT-X-VERSION:${PLAYLIST_VERSION}`,
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXT-X-MEDIA-SEQUENCE:0',
    ...played.flatMap(({ url, durationSeconds }) => [
      `#EXTINF:${durationSeconds.toFixed(3)},`,
      url,
    ]),
  ];

  if (gapIndex === -1) {
    lines.push('#EXT-X-ENDLIST');
  }

  return `${lines.join('\n')}\n`;
}
