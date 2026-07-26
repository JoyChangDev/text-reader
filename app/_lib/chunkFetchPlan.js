// Given the reader's current chunk and a look-ahead window, decides which chunk
// indices still need an /api/audio-chunks request. Chunks already loading or ready
// are skipped; a chunk in error state is left for a manual retry (ticket 08), not
// retried automatically here.
export function chunkFetchPlan({ totalChunks, currentIndex, lookahead, statuses }) {
  const plan = [];
  const end = Math.min(totalChunks, currentIndex + lookahead + 1);

  for (let index = currentIndex; index < end; index += 1) {
    const status = statuses[index];
    if (status !== 'loading' && status !== 'ready' && status !== 'error') {
      plan.push(index);
    }
  }

  return plan;
}
