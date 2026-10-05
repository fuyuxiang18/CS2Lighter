import { describe, expect, it, vi } from 'vite-plus/test';
vi.mock('csdm/node/database/database', () => ({ db: {} }));
import { normalizeReviewClipRange } from './resolve-review-clip';

const request = { checksum: 'abc', steamId: '76561198000000001', roundNumber: 1, startTick: 500 };
describe('review clip boundaries', () => {
  it('uses the demo tickrate, then clamps the default twenty seconds to the round end', () => {
    expect(normalizeReviewClipRange(request, 128, 100, 4000).endTick).toBe(3060);
    expect(normalizeReviewClipRange(request, 64, 100, 1200).endTick).toBe(1200);
  });
  it('rejects invalid ranges and recordings longer than 45 seconds', () => {
    for (const startTick of [99, 4000, Number.NaN, 501.5])
      expect(() => normalizeReviewClipRange({ ...request, startTick }, 64, 100, 4000)).toThrow();
    expect(() => normalizeReviewClipRange({ ...request, endTick: 500 }, 64, 100, 4000)).toThrow();
    expect(() => normalizeReviewClipRange({ ...request, endTick: 3900 }, 64, 100, 4000)).toThrow();
    expect(() => normalizeReviewClipRange(request, 0, 100, 4000)).toThrow();
  });
});
