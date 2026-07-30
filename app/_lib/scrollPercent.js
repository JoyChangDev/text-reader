// How much of a scrollable container's content can actually be scrolled - shared by
// both directions of the scrollTop <-> percentage conversion below.
export function scrollableRange(container) {
  return container.scrollHeight - container.clientHeight;
}

// A scrollable container's current scroll position as a percentage - purely a function
// of its own scroll geometry, with no chunk index or audio duration data involved (see
// ticket 04).
export function computeScrollPercent(container) {
  if (!container) return 0;
  const scrollable = scrollableRange(container);
  return scrollable > 0 ? (container.scrollTop / scrollable) * 100 : 0;
}
