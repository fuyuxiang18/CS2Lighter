import { expect, it } from 'vite-plus/test';
import { planReviewCapturePasses, reviewWarmupTick } from './review-capture-plan';

it('makes forward passes while retaining all original, overlapping POV ranges', () => {
  const input = [
    { number: 5, startTick: 4000, endTick: 4200 },
    { number: 1, startTick: 500, endTick: 700 },
    { number: 2, startTick: 500, endTick: 650 },
    { number: 3, startTick: 2000, endTick: 2200 },
    { number: 4, startTick: 2000, endTick: 2180 },
  ].map((sequence) => ({ sequence, tickrate: 64 }));
  const original = structuredClone(input);
  expect(planReviewCapturePasses(input).map(({ sequence }) => sequence.number)).toEqual([1, 3, 5, 2, 4]);
  expect(input).toEqual(original);
});

it('keeps warm-up before setup for early clips and adapts to each demo tickrate', () => {
  expect(reviewWarmupTick({ sequence: { number: 1, startTick: 120, endTick: 300 }, tickrate: 64 })).toBe(1);
  expect(reviewWarmupTick({ sequence: { number: 1, startTick: 2000, endTick: 2200 }, tickrate: 128 })).toBe(1488);
  expect(planReviewCapturePasses([{ sequence: { number: 1, startTick: 1, endTick: 60 }, tickrate: 64 }])).toHaveLength(
    1,
  );
});
