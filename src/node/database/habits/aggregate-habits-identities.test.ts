import { describe, expect, it } from 'vite-plus/test';
import { aggregateHabitsIdentities } from './aggregate-habits-identities';

describe('aggregateHabitsIdentities', () => {
  it('preserves ambiguous identities, counts distinct matches and ignores bots', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const candidates = aggregateHabitsIdentities('Same nickname', [
      { steamId: '76561198000000001', checksum: 'a', date },
      { steamId: '76561198000000001', checksum: 'a', date },
      { steamId: '76561198000000002', checksum: 'b', date },
      { steamId: '0', checksum: 'c', date },
      { steamId: 'BOT', checksum: 'd', date },
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.matchCount)).toEqual([1, 1]);
    expect(candidates.map((candidate) => candidate.steamId)).toEqual(['76561198000000001', '76561198000000002']);
  });

  it('retains the exact nickname and most recent date even for unsorted rows', () => {
    const candidates = aggregateHabitsIdentities('  Mixed Case  ', [
      { steamId: '76561198000000001', checksum: 'a', date: new Date('2026-01-01T00:00:00Z') },
      { steamId: '76561198000000001', checksum: 'b', date: new Date('2026-04-01T00:00:00Z') },
    ]);
    expect(candidates[0]).toMatchObject({
      nickname: '  Mixed Case  ',
      matchCount: 2,
      lastSeen: '2026-04-01T00:00:00.000Z',
    });
  });
});
