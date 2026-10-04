import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, TeamNumber } from 'csdm/common/types/counter-strike';
import { createHabitsAccumulator, type HabitsMatchInput, type HabitsPositionSample } from './aggregate-habits';

const steamId = '76561198000000001';

function position(tick: number, changes: Partial<HabitsPositionSample> = {}): HabitsPositionSample {
  return { roundNumber: 1, tick, side: TeamNumber.T, isAlive: true, x: 10, y: 10, z: 10, ...changes };
}

function match(changes: Partial<HabitsMatchInput> = {}): HabitsMatchInput {
  return {
    checksum: 'match-a',
    date: '2026-01-01T00:00:00Z',
    mapName: 'de_mirage',
    buildNumber: 1,
    gameMode: 'competitive',
    source: DemoSource.PerfectWorld,
    tickrate: 10,
    rounds: [{ number: 1, freezeEndTick: 100, endTick: 500, side: TeamNumber.T }],
    positions: [],
    kills: [],
    ...changes,
  };
}

function kill(changes: Partial<HabitsMatchInput['kills'][number]> = {}): HabitsMatchInput['kills'][number] {
  return {
    roundNumber: 1,
    tick: 200,
    killerSteamId: steamId,
    victimSteamId: '76561198000000002',
    killerSide: TeamNumber.T,
    victimSide: TeamNumber.CT,
    killerX: 10,
    killerY: 10,
    killerZ: 10,
    victimX: 20,
    victimY: 20,
    victimZ: 20,
    ...changes,
  };
}

describe('habits aggregation', () => {
  it('weights time rather than number of samples and clips freeze time', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, ['de_mirage']);
    addMatch(match({ positions: [position(90), position(105), position(110, { x: 300 }), position(130)] }));
    expect(summary.observedSeconds).toBe(3);
    expect(summary.cohorts[0].bins.map((bin) => bin.seconds)).toEqual([1, 2]);
    expect(summary.cohorts[0].bins[0].evidence[0].tick).toBe(100);
    expect(summary.positionRoundCount).toBe(1);
  });

  it('does not fill long gaps, count dead time, or invent time after the last sample', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        positions: [position(100), position(110), position(300), position(310, { isAlive: false }), position(320)],
      }),
    );
    expect(summary.observedSeconds).toBe(2);
    expect(summary.cohorts[0].bins[0].roundCount).toBe(1);
  });

  it('clips the opening window and round end independently', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match({ positions: [position(290), position(310), position(490), position(510)] }));
    expect(summary.observedSeconds).toBe(3);
    expect(summary.cohorts[0].openingSeconds).toBe(1);
  });

  it('never bridges round boundaries and keeps floor bands separate', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        rounds: [
          { number: 1, freezeEndTick: 100, endTick: 130, side: TeamNumber.T },
          { number: 2, freezeEndTick: 140, endTick: 180, side: TeamNumber.T },
        ],
        positions: [
          position(100),
          position(110),
          position(140, { roundNumber: 2, z: 300 }),
          position(150, { roundNumber: 2, z: 300 }),
        ],
      }),
    );
    expect(summary.observedSeconds).toBe(2);
    expect(summary.positionRoundCount).toBe(2);
    expect(summary.cohorts[0].bins.map((bin) => bin.z)).toEqual([128, 384]);
  });

  it('keeps builds and modes separate and deduplicates repeated demo checksums', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match());
    addMatch(match());
    addMatch(match({ checksum: 'match-b', buildNumber: 2 }));
    addMatch(match({ checksum: 'match-c', gameMode: 'wingman' }));
    expect(summary.matchCount).toBe(3);
    expect(summary.cohorts).toHaveLength(3);
    expect(summary.matchesWithPositions).toBe(0);
  });

  it('uses only the selected side in both event and round denominators', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, TeamNumber.CT, []);
    addMatch(match({ positions: [position(100), position(110)], kills: [kill()] }));
    expect(summary.matchCount).toBe(0);
    expect(summary.roundCount).toBe(0);
    expect(summary.kills).toBe(0);
  });

  it('finds the first opposing-team kill and does not label a later personal kill as an opening', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        kills: [
          kill({ tick: 90 }),
          kill({ tick: 110, victimSide: TeamNumber.T }),
          kill({ tick: 120, killerSteamId: '76561198000000003' }),
          kill({ tick: 200 }),
          kill({
            tick: 210,
            killerSteamId: '76561198000000002',
            victimSteamId: steamId,
            killerSide: TeamNumber.CT,
            victimSide: TeamNumber.T,
          }),
        ],
      }),
    );
    expect(summary.kills).toBe(1);
    expect(summary.deaths).toBe(1);
    expect(summary.openingKills).toBe(0);
    expect(summary.openingDeaths).toBe(0);
    expect(summary.evidence.map((event) => [event.kind, event.tick])).toEqual([
      ['kill', 200],
      ['death', 210],
    ]);
  });

  it('retains kill evidence and denominators when positions are missing', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match({ kills: [kill()] }));
    expect(summary.roundCount).toBe(1);
    expect(summary.positionRoundCount).toBe(0);
    expect(summary.openingKills).toBe(1);
    expect(summary.evidence[0]).toMatchObject({ checksum: 'match-a', roundNumber: 1, tick: 200, kind: 'kill' });
  });

  it('counts world deaths without calling them an opening duel and clips position time at death', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        positions: [position(100), position(110, { isAlive: false })],
        kills: [
          kill({
            tick: 105,
            killerSteamId: '0',
            victimSteamId: steamId,
            killerSide: TeamNumber.UNASSIGNED,
            victimSide: TeamNumber.T,
          }),
        ],
      }),
    );
    expect(summary.observedSeconds).toBe(0.5);
    expect(summary.deaths).toBe(1);
    expect(summary.openingDeaths).toBe(0);
  });

  it('keeps unknown-source local imports and source cohorts distinct', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match());
    addMatch(match({ checksum: 'match-b', source: DemoSource.Unknown }));
    expect(summary.matchCount).toBe(2);
    expect(summary.cohorts.map((cohort) => cohort.source)).toEqual([DemoSource.PerfectWorld, DemoSource.Unknown]);
  });

  it('splits a vertical grid cell at the actual radar threshold rather than its center', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        floorThresholdZ: 100,
        positions: [position(100, { z: 90 }), position(110, { z: 110 }), position(120, { z: 110 })],
      }),
    );
    expect(summary.cohorts[0].bins.map((bin) => [bin.z, bin.level, bin.seconds])).toEqual([
      [128, 'lower', 1],
      [128, 'upper', 1],
    ]);
  });

  it('merges height bands on the same radar level without duplicating round visits', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        floorThresholdZ: 100,
        positions: [position(100, { z: 110 }), position(110, { z: 390 }), position(120, { z: 390 })],
      }),
    );
    expect(summary.cohorts[0].bins).toHaveLength(1);
    expect(summary.cohorts[0].bins[0]).toMatchObject({
      level: 'upper',
      seconds: 2,
      roundCount: 1,
      openingRoundCount: 1,
    });
  });

  it('does not split a known single-level radar when heights straddle zero', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        singleLevelMap: true,
        floorThresholdZ: 0,
        positions: [position(100, { z: -10 }), position(110, { z: 10 }), position(120, { z: 10 })],
      }),
    );
    expect(summary.cohorts[0].bins).toHaveLength(1);
    expect(summary.cohorts[0].bins[0]).toMatchObject({ level: 'upper', seconds: 2 });
  });

  it('keeps opening-window round counts and evidence independent from later visits', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match({ positions: [position(400), position(410)] }));
    addMatch(match({ checksum: 'match-b', positions: [position(100), position(110)] }));
    const bin = summary.cohorts[0].bins[0];
    expect(bin.roundCount).toBe(2);
    expect(bin.openingRoundCount).toBe(1);
    expect(bin.openingEvidence).toHaveLength(1);
    expect(bin.openingEvidence[0]).toMatchObject({ checksum: 'match-b', tick: 100, kind: 'opening' });
  });

  it('excludes warmup round zero from both event and positional denominators', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(
      match({
        rounds: [{ number: 0, freezeEndTick: 100, endTick: 500, side: TeamNumber.T }],
        positions: [position(100, { roundNumber: 0 }), position(110, { roundNumber: 0 })],
        kills: [kill({ roundNumber: 0 })],
      }),
    );
    expect(summary.matchCount).toBe(0);
    expect(summary.roundCount).toBe(0);
    expect(summary.kills).toBe(0);
    expect(summary.observedSeconds).toBe(0);
  });

  it('rejects non-finite positions and invalid tick rates without losing event data', () => {
    const { addMatch, summary } = createHabitsAccumulator(steamId, undefined, []);
    addMatch(match({ positions: [position(100, { x: Number.NaN }), position(110)], kills: [kill()] }));
    addMatch(match({ checksum: 'match-b', tickrate: 0, positions: [position(100), position(110)] }));
    expect(summary.observedSeconds).toBe(0);
    expect(summary.kills).toBe(1);
  });
});
