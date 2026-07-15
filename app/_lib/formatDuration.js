// TODO (Lesson 0001): implement this so it turns whole seconds into an
// "mm:ss" string, e.g. formatDuration(65) -> "01:05".
export function formatDuration(totalSeconds) {
  const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${mins}:${seconds}`;
}
