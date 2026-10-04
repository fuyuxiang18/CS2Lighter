import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, TeamNumber } from 'csdm/common/types/counter-strike';
import { createHabitsAccumulator, type HabitsMatchInput } from 'csdm/node/database/habits/aggregate-habits';
import { createCachedHabitsMerger } from './merge-cached-habits';

const steamId = '76561198000000001';
function match(checksum: string, side: TeamNumber, buildNumber = 1): HabitsMatchInput {
  return {
    checksum,
    date: '2026-01-01',
    mapName: 'de_nuke',
    buildNumber,
    gameMode: 'competitive',
    source: DemoSource.PerfectWorld,
    tickrate: 10,
    floorThresholdZ: 100,
    rounds: [{ number: 1, freezeEndTick: 0, endTick: 100, side }],
    positions: [0, 10, 20, 30].map((tick) => ({
      roundNumber: 1,
      tick,
      side,
      isAlive: true,
      x: 1,
      y: 1,
      z: tick >= 20 ? 300 : 0,
    })),
    kills: [
      {
        roundNumber: 1,
        tick: 35,
        killerSteamId: steamId,
        victimSteamId: 'other',
        killerSide: side,
        victimSide: side === TeamNumber.T ? TeamNumber.CT : TeamNumber.T,
        killerX: 1,
        killerY: 1,
        killerZ: 0,
        victimX: 1,
        victimY: 1,
        victimZ: 0,
      },
    ],
  };
}
describe('compact habits merging', () => {
  it.each([undefined, TeamNumber.T, TeamNumber.CT])(
    'matches direct raw aggregation for side %s and caps evidence',
    (side) => {
      const direct = createHabitsAccumulator(steamId, side, ['de_nuke']);
      const merged = createCachedHabitsMerger(steamId, ['de_nuke']);
      for (let index = 0; index < 120; index++) {
        const input = match(String(index), index % 2 === 0 ? TeamNumber.T : TeamNumber.CT, index % 3 === 0 ? 2 : 1);
        direct.addMatch(input);
        const perMatch = createHabitsAccumulator(steamId, side, ['de_nuke']);
        perMatch.addMatch(input);
        const before = structuredClone(perMatch.summary);
        merged.add(input.checksum, perMatch.summary);
        merged.add(input.checksum, perMatch.summary);
        expect(perMatch.summary).toEqual(before);
      }
      expect(merged.summary).toEqual(direct.summary);
    },
  );
});
