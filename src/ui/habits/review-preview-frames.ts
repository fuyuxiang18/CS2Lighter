import type { ReviewPreviewPosition } from 'csdm/common/types/review-preview';

export function buildReviewPreviewFrames(positions: ReviewPreviewPosition[]) {
  const byTick = new Map<number, ReviewPreviewPosition[]>();
  for (const position of positions) {
    const frame = byTick.get(position.tick) ?? [];
    frame.push(position);
    byTick.set(position.tick, frame);
  }
  return [...byTick].sort(([a], [b]) => a - b).map(([tick, players]) => ({ tick, players }));
}

// Render the latest recorded frame, never a future frame or a position across a long gap.
export function reviewPreviewFrameAt(
  frames: ReturnType<typeof buildReviewPreviewFrames>,
  tick: number,
  tickrate: number,
) {
  let low = 0;
  let high = frames.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].tick <= tick) low = middle + 1;
    else high = middle - 1;
  }
  const frame = frames[high];
  return frame && tick - frame.tick <= Math.max(1, tickrate * 0.2) ? frame : undefined;
}
