type CaptureRange = {
  sequence: { number: number; startTick: number; endTick: number };
  tickrate: number;
};

export function reviewWarmupTick(range: CaptureRange): number {
  // Keep every initialization command before camera setup, including early-round clips.
  const setupTick = Math.max(1, range.sequence.startTick - Math.round(range.tickrate));
  return Math.max(1, Math.min(setupTick - 1, range.sequence.startTick - Math.ceil(range.tickrate * 4)));
}

export function reviewBoundaryTick(range: CaptureRange): number {
  return range.sequence.endTick + Math.max(1, Math.round(range.tickrate));
}

/** Capture forward passes, without changing segment IDs or the final player's/opponent's montage order. */
export function planReviewCapturePasses<T extends CaptureRange>(ranges: T[]): T[] {
  const remaining = ranges.toSorted(
    (a, b) => a.sequence.startTick - b.sequence.startTick || a.sequence.number - b.sequence.number,
  );
  const planned: T[] = [];
  while (remaining.length) {
    let boundary: number | undefined;
    for (let index = 0; index < remaining.length;) {
      const range = remaining[index];
      if (boundary === undefined || reviewWarmupTick(range) > boundary + 1) {
        planned.push(range);
        boundary = reviewBoundaryTick(range);
        remaining.splice(index, 1);
      } else index++;
    }
  }
  return planned;
}
