import { describe, expect, it } from 'vite-plus/test';
import { buildReviewPreviewFrames, reviewPreviewFrameAt } from './review-preview-frames';
import type { ReviewPreviewPosition } from 'csdm/common/types/review-preview';

describe('review preview frames', () => {
  it('groups exact recorded ticks and does not borrow future or stale positions', () => {
    const positions = [{ tick: 104 }, { tick: 100 }, { tick: 100 }, { tick: 200 }] as ReviewPreviewPosition[];
    const frames = buildReviewPreviewFrames(positions);
    expect(frames.map((frame) => frame.tick)).toEqual([100, 104, 200]);
    expect(reviewPreviewFrameAt(frames, 99, 64)).toBeUndefined();
    expect(reviewPreviewFrameAt(frames, 101, 64)?.players).toHaveLength(2);
    expect(reviewPreviewFrameAt(frames, 104, 64)?.tick).toBe(104);
    expect(reviewPreviewFrameAt(frames, 150, 64)).toBeUndefined();
    expect(reviewPreviewFrameAt([], 100, 64)).toBeUndefined();
  });
});
