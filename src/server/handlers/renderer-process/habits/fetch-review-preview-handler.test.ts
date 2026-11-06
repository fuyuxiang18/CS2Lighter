import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { fetchReviewPreviewHandler } from './fetch-review-preview-handler';

const mocks = vi.hoisted(() => ({ round: vi.fn(), positions: vi.fn(), complete: vi.fn(), generation: 0 }));
vi.mock('csdm/node/database/database', () => {
  const query = { innerJoin: () => query, select: () => query, where: () => query, executeTakeFirst: mocks.round };
  return { db: { selectFrom: () => query } };
});
vi.mock('csdm/node/database/player-position/fetch-players-positions', () => ({
  fetchPlayersPositions: mocks.positions,
}));
vi.mock('csdm/node/database/matches/match-import-state', () => ({ assertMatchImportComplete: mocks.complete }));
vi.mock('csdm/node/demo-cache/invalidate-demo-cache', () => ({ getDemoCacheGeneration: () => mocks.generation }));
vi.mock('../../handle-error', () => ({
  handleError: (error: unknown) => {
    throw error;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 0;
  mocks.round.mockResolvedValue({ start_tick: 100, end_tick: 10000, end_officially_tick: 10100, tickrate: 64 });
  mocks.positions.mockResolvedValue([]);
});

describe('saved-position preview', () => {
  it('clamps to the recorded round and requests only that time window', async () => {
    const result = await fetchReviewPreviewHandler({ checksum: 'aa', roundNumber: 1, startTick: 50, endTick: 500 });
    expect(mocks.positions).toHaveBeenCalledWith('aa', 1, { startTick: 100, endTick: 500 });
    expect(result).toEqual({ startTick: 100, endTick: 500, tickrate: 64, positions: [] });
  });
  it('rejects invalid, oversized or unknown-clock windows before reading positions', async () => {
    await expect(
      fetchReviewPreviewHandler({ checksum: 'aa', roundNumber: 0, startTick: 100, endTick: 200 }),
    ).rejects.toThrow('Invalid');
    await expect(
      fetchReviewPreviewHandler({ checksum: 'aa', roundNumber: 1, startTick: 100, endTick: 9000 }),
    ).rejects.toThrow('45');
    mocks.round.mockResolvedValue({ start_tick: 100, end_tick: 1000, end_officially_tick: 1100, tickrate: 0 });
    await expect(
      fetchReviewPreviewHandler({ checksum: 'aa', roundNumber: 1, startTick: 100, endTick: 200 }),
    ).rejects.toThrow('timing');
    expect(mocks.positions).not.toHaveBeenCalled();
  });
  it('does not return frames from a concurrently replaced match', async () => {
    mocks.positions.mockImplementationOnce(() => {
      mocks.generation++;
      return Promise.resolve([]);
    });
    await expect(
      fetchReviewPreviewHandler({ checksum: 'aa', roundNumber: 1, startTick: 100, endTick: 200 }),
    ).rejects.toThrow('changed');
  });
});
