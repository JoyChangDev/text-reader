// The `from` query parameter both HLS routes take: which Chunk the playlist being served
// starts at. A Listener sets it by seeking past a stretch of the Book that was never
// narrated, which the playlist can't reach because it truncates at its first gap — see
// .scratch/phase-1-10-continuous-hls-playback/issues/07-seeking-past-the-generated-region.md.
//
// Shared rather than parsed twice, because the playlist and the manifest have to agree on
// where the timeline's zero is. A route reading it one way and the other reading it
// another would put every cue at the wrong second, which is exactly the kind of drift
// that shows up as "highlighting is slightly off" rather than as an error.
export function parsePlaylistStart(value, { chunkCount }) {
  if (value === null || value === undefined) return { from: 0 };

  // Number('') is 0, so an empty `?from=` would otherwise pass for "start at the
  // beginning" instead of being read as the malformed request it is.
  const from = value === '' ? Number.NaN : Number(value);
  if (!Number.isInteger(from) || from < 0 || from >= chunkCount) {
    return { error: 'from must be a Chunk index in this Book' };
  }

  return { from };
}
