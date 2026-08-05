// One rule, in one place: whether a Chunk's stored metadata can back a segment on the
// Book's timeline. A Chunk cached before ticket 02 has a url and boundaries but no
// duration, so it can neither be given an #EXTINF nor placed at a startSeconds — and a
// stored zero would silently become #EXTINF:0. Both HLS routes read it as "not there
// yet" so the Chunk is requested again, which is what triggers the lazy re-measurement
// in audioGenerationService.js.
export function isPlayableChunk(metadata) {
  return metadata?.durationSeconds > 0;
}
