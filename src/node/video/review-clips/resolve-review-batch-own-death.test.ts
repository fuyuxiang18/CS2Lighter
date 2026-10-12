import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ReviewClipRequest } from 'csdm/common/types/review-clip';
import { resolveReviewBatch } from './resolve-review-batch';

const rows = vi.hoisted(() => ({
  kills: [] as Record<string, unknown>[],
  damages: [] as Record<string, unknown>[],
  players: [] as Record<string, unknown>[],
}));
vi.mock('csdm/node/database/database', () => ({
  db: {
    selectFrom(table: keyof typeof rows) {
      return {
        select() {
          return this;
        },
        where() {
          return this;
        },
        execute: () => Promise.resolve(rows[table]),
      };
    },
  },
}));
vi.mock('./resolve-review-clip', () => ({
  resolveReviewClip: (request: ReviewClipRequest) =>
    Promise.resolve({
      request: { ...request, endTick: request.endTick ?? 1800 },
      demoPath: '/synthetic/demo.dem',
      mapName: 'de_mirage',
      playerName: 'Synthetic player',
      tickrate: 64,
      revision: '1',
    }),
}));

const player = '76561198000000001';
const enemy = '76561198000000002';
const request = {
  checksum: 'fixture',
  steamId: player,
  roundNumber: 1,
  startTick: 1000,
  endTick: 1800,
  eventTick: 1400,
};
beforeEach(() => {
  rows.kills = [{ tick: 1300, killer_steam_id: player, victim_steam_id: enemy, killer_side: 2, victim_side: 3 }];
  rows.damages = [];
  rows.players = [
    { steam_id: player, name: 'Synthetic player', index: 1 },
    { steam_id: enemy, name: 'Synthetic enemy', index: 2 },
  ];
});

describe('own-only death recording resolution', () => {
  it.each([
    { killer: player, side: 2 },
    { killer: '76561198000000003', side: 2 },
    { killer: '0', side: 0 },
  ])('resolves the recorded victim POV and labels the event as death ($killer)', async ({ killer, side }) => {
    rows.kills.push({
      tick: 1400,
      killer_steam_id: killer,
      victim_steam_id: player,
      killer_side: side,
      victim_side: 2,
    });
    const result = await resolveReviewBatch({ includeOpponent: true, clips: [{ ...request, includeOpponent: false }] });
    expect(result.items[0].eventKind).toBe('death');
    expect(result.items[0].item.opponentSteamId).toBeUndefined();
    expect(result.items[0].item.segments).toHaveLength(1);
    expect(result.items[0].item.segments[0]).toMatchObject({
      perspective: 'player',
      steamId: player,
      endTick: 1399,
      truncatedAtDeath: true,
    });
  });
  it('inherits the batch own-only setting when the clip has no override', async () => {
    rows.kills.push({ tick: 1400, killer_steam_id: '0', victim_steam_id: player, killer_side: 0, victim_side: 2 });
    const result = await resolveReviewBatch({ includeOpponent: false, clips: [request] });
    expect(result.items[0].eventKind).toBe('death');
    expect(result.items[0].item.opponentSteamId).toBeUndefined();
    expect(result.items[0].item.segments.map((segment) => segment.perspective)).toEqual(['player']);
  });
  it('rejects a fabricated death tick even in an otherwise valid player range', async () => {
    rows.kills.push({ tick: 1400, killer_steam_id: '0', victim_steam_id: player, killer_side: 0, victim_side: 2 });
    await expect(
      resolveReviewBatch({ includeOpponent: false, clips: [{ ...request, eventTick: 1401 }] }),
    ).rejects.toThrow('event tick has no combat');
  });
  it('never substitutes a nearby opponent for a self death when opponent POV was requested', async () => {
    rows.kills.push({ tick: 1400, killer_steam_id: player, victim_steam_id: player, killer_side: 2, victim_side: 2 });
    await expect(resolveReviewBatch({ includeOpponent: true, clips: [request] })).rejects.toThrow(
      'event tick has no combat',
    );
  });
});
