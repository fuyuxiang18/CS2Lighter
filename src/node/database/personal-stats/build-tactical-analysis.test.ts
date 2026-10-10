import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, EconomyType, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import type { TacticalAnalysis, TacticalScenarioCode } from 'csdm/common/types/tactical-analysis';
import { aggregatePersonalStats } from './aggregate-personal-stats';
import { buildTacticalAnalysis } from './build-tactical-analysis';

const steamId = '76561198000000001';

function round(number: number, overrides: Partial<PersonalRoundStats> = {}): PersonalRoundStats {
  return {
    roundNumber: number,
    startTick: number * 1000,
    openingKillTick: null,
    openingDeathTick: null,
    deathTick: null,
    teamFlashTick: null,
    clutchTick: null,
    side: TeamNumber.T,
    won: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    headshotKills: 0,
    damage: 0,
    utilityDamage: 0,
    friendlyDamage: 0,
    flashAssists: 0,
    tradeKills: 0,
    tradedDeaths: 0,
    openingKill: false,
    openingDeath: false,
    survived: true,
    kast: true,
    clutchOpponents: null,
    clutchWon: false,
    bombPlants: 0,
    bombDefuses: 0,
    flashesThrown: 0,
    smokesThrown: 0,
    heThrown: 0,
    fireThrown: 0,
    decoysThrown: 0,
    enemiesFlashed: 0,
    enemyBlindSeconds: 0,
    teammatesFlashed: 0,
    economyType: EconomyType.Full,
    equipmentValue: 4000,
    moneySpent: 3000,
    rws: 0,
    weapons: [],
    ...overrides,
  };
}

function match(
  checksum: string,
  rounds: PersonalRoundStats[],
  overrides: Partial<PersonalMatchStats> = {},
): PersonalMatchStats {
  return {
    checksum,
    steamId,
    name: 'Synthetic player',
    date: '2026-01-01T00:00:00.000Z',
    mapName: 'de_inferno',
    source: DemoSource.PerfectWorld,
    gameMode: GameMode.Competitive,
    buildNumber: 1,
    tickrate: 64,
    result: 'win',
    ratingEligible: true,
    ratingEligibilityBasis: 'mode',
    demoRoundCount: rounds.length,
    rounds,
    ...overrides,
  };
}

function scenario(analysis: TacticalAnalysis, code: TacticalScenarioCode) {
  return analysis.scenarios.find((entry) => entry.code === code)!;
}

describe('tactical analysis from unchanged cached round facts', () => {
  it('keeps empty and zero-denominator scenarios missing instead of claiming zero success', () => {
    const empty = buildTacticalAnalysis([]);
    expect(empty.scenarios).toHaveLength(17);
    for (const item of empty.scenarios) {
      expect(item).toMatchObject({
        frequency: { count: 0, total: 0, percentage: null },
        wins: 0,
        winPercentage: null,
        adr: null,
        evidence: [],
      });
    }
    const ordinary = buildTacticalAnalysis([match('ordinary', [round(1)])]);
    expect(scenario(ordinary, 'trade-kill-round')).toMatchObject({
      frequency: { count: 0, total: 1, percentage: 0 },
      winPercentage: null,
      adr: null,
    });
    expect(scenario(ordinary, 'opening-kill-survived').frequency.percentage).toBeNull();
    expect(JSON.stringify(empty)).not.toMatch(/NaN|Infinity/);
  });

  it('measures opening outcomes and trades with their own conditional denominators', () => {
    const result = buildTacticalAnalysis([
      match('a', [
        round(1, { openingKill: true, openingKillTick: 1600, won: true, damage: 120 }),
        round(2, {
          openingKill: true,
          openingKillTick: 2600,
          survived: false,
          deaths: 1,
          deathTick: 3240,
          damage: 80,
        }),
        round(3, {
          openingKill: true,
          openingKillTick: 3600,
          survived: false,
          deaths: 1,
          deathTick: 4241,
          won: true,
          damage: 20,
        }),
        round(4, { openingDeath: true, openingDeathTick: 4800, deaths: 1, survived: false, tradedDeaths: 1 }),
        round(5, { openingDeath: true, openingDeathTick: 5800, deaths: 1, survived: false, won: true, damage: 50 }),
        round(6, { tradeKills: 2, won: true, damage: 90 }),
        round(7),
        round(8),
      ]),
    ]);
    expect(scenario(result, 'opening-kill-survived')).toMatchObject({
      frequency: { count: 1, total: 3 },
      wins: 1,
      winPercentage: 100,
      adr: 120,
    });
    expect(scenario(result, 'opening-kill-died')).toMatchObject({
      frequency: { count: 2, total: 3 },
      wins: 1,
      winPercentage: 50,
      adr: 50,
    });
    expect(scenario(result, 'opening-kill-quick-death')).toMatchObject({
      frequency: { count: 1, total: 3 },
      wins: 0,
      adr: 80,
      evidence: [{ roundNumber: 2, tick: 2088, won: false }],
    });
    expect(scenario(result, 'opening-death-traded')).toMatchObject({
      frequency: { count: 1, total: 2, percentage: 50 },
      wins: 0,
      evidence: [{ roundNumber: 4, tick: 4288 }],
    });
    expect(scenario(result, 'opening-death-untraded')).toMatchObject({
      frequency: { count: 1, total: 2, percentage: 50 },
      wins: 1,
      adr: 50,
    });
    expect(scenario(result, 'trade-kill-round')).toMatchObject({
      frequency: { count: 1, total: 8, percentage: 12.5 },
      wins: 1,
      adr: 90,
      evidence: [{ roundNumber: 6, tick: 6000 }],
    });
  });

  it('counts utility rounds once, distinguishes short blinds, and uses throws as the eligibility condition', () => {
    const result = buildTacticalAnalysis([
      match('utility', [
        round(1, {
          flashesThrown: 3,
          flashAssists: 2,
          enemiesFlashed: 2,
          teammatesFlashed: 2,
          teamFlashTick: 1700,
          heThrown: 2,
          fireThrown: 1,
          utilityDamage: 30,
          damage: 70,
          won: true,
        }),
        round(2, { flashesThrown: 1, enemyBlindSeconds: 0.8, flashAssists: 1, fireThrown: 1 }),
        round(3, { flashesThrown: 1, enemiesFlashed: 1, heThrown: 1 }),
        // Legacy effects with no throw record are not evidence of a throwing opportunity.
        round(4, { teammatesFlashed: 1, utilityDamage: 20, damage: 20 }),
      ]),
    ]);
    expect(scenario(result, 'flash-assist-round')).toMatchObject({
      frequency: { count: 2, total: 4, percentage: 50 },
      wins: 1,
      winPercentage: 50,
    });
    expect(scenario(result, 'flash-without-long-enemy-blind')).toMatchObject({
      frequency: { count: 1, total: 3 },
      evidence: [{ roundNumber: 2, tick: 2000 }],
    });
    expect(scenario(result, 'teammate-flash-round')).toMatchObject({
      frequency: { count: 1, total: 3 },
      evidence: [{ roundNumber: 1, tick: 1188 }],
    });
    expect(scenario(result, 'damage-utility-hit')).toMatchObject({
      frequency: { count: 1, total: 3 },
      adr: 70,
    });
    expect(scenario(result, 'damage-utility-no-damage')).toMatchObject({
      frequency: { count: 2, total: 3 },
      wins: 0,
      adr: 0,
    });
  });

  it('separates personal plants, clutch difficulty and known low equipment without inventing team buy states', () => {
    const result = buildTacticalAnalysis([
      match('objectives', [
        round(1, { bombPlants: 1, won: true, damage: 120, clutchOpponents: 1, clutchWon: true, equipmentValue: 2000 }),
        round(2, { bombPlants: 1, clutchOpponents: 1, equipmentValue: 0 }),
        round(3, {
          side: TeamNumber.CT,
          bombPlants: 1,
          won: true,
          clutchOpponents: 2,
          clutchWon: true,
          equipmentValue: null,
        }),
        round(4, { clutchOpponents: 3, equipmentValue: 2001 }),
        round(5, { clutchOpponents: 5, equipmentValue: -1 }),
        round(6, { equipmentValue: Number.NaN }),
      ]),
    ]);
    expect(scenario(result, 'personal-plant-won')).toMatchObject({ frequency: { count: 1, total: 2 }, wins: 1 });
    expect(scenario(result, 'personal-plant-lost')).toMatchObject({ frequency: { count: 1, total: 2 }, wins: 0 });
    expect(scenario(result, 'clutch-1v1')).toMatchObject({
      frequency: { count: 2, total: 5, percentage: 40 },
      wins: 1,
      winPercentage: 50,
      adr: 60,
      evidence: [
        { roundNumber: 1, won: true },
        { roundNumber: 2, won: false },
      ],
    });
    expect(scenario(result, 'clutch-1v2plus')).toMatchObject({ frequency: { count: 3, total: 5 }, wins: 1 });
    expect(scenario(result, 'clutch-1v2plus').winPercentage).toBeCloseTo(100 / 3);
    expect(scenario(result, 'low-equipment-damage')).toMatchObject({
      frequency: { count: 1, total: 2, percentage: 50 },
      adr: 120,
    });
    expect(scenario(result, 'low-equipment-no-damage')).toMatchObject({
      frequency: { count: 1, total: 2, percentage: 50 },
      adr: 0,
    });
  });

  it('excludes invalid timing from ten-second eligibility while preserving ordinary opening observations', () => {
    const timed = (overrides: Partial<PersonalRoundStats> = {}) =>
      round(1, { openingKill: true, openingKillTick: 1100, survived: false, deaths: 1, deathTick: 1740, ...overrides });
    const result = buildTacticalAnalysis([
      match('valid', [timed()]),
      match('survivor', [timed({ survived: true, deaths: 0, deathTick: null })]),
      match('missing-death', [timed({ deathTick: null })]),
      match('reversed-time', [timed({ deathTick: 1099 })]),
      match('early-opening', [timed({ openingKillTick: 999 })]),
      match('missing-opening', [timed({ openingKillTick: null })]),
      match('zero-tickrate', [timed()], { tickrate: 0 }),
      match('infinite-tickrate', [timed()], { tickrate: Number.POSITIVE_INFINITY }),
      match('invalid-death', [timed({ deathTick: Number.NaN })]),
    ]);
    expect(scenario(result, 'opening-kill-quick-death')).toMatchObject({
      frequency: { count: 1, total: 2, percentage: 50 },
      evidence: [{ checksum: 'valid', tick: 1000 }],
    });
    expect(scenario(result, 'opening-kill-died').frequency).toMatchObject({ count: 8, total: 9 });
    expect(result.scenarios.flatMap((entry) => entry.evidence).every((entry) => Number.isFinite(entry.tick))).toBe(
      true,
    );
  });

  it('honors aggregation identity, deduplication, side, map and source filters and excludes nonstandard modes', () => {
    const chosen = match('chosen', [round(1, { tradeKills: 1, damage: 80 }), round(2, { side: TeamNumber.CT })]);
    const result = aggregatePersonalStats(
      [
        chosen,
        chosen,
        match('other-player', [round(1)], { steamId: '76561198000000002' }),
        match('other-map', [round(1)], { mapName: 'de_nuke' }),
        match('other-source', [round(1)], { source: DemoSource.Valve }),
        match('nonstandard', [round(1, { tradeKills: 20 })], { ratingEligible: false, gameMode: GameMode.Deathmatch }),
      ],
      { steamId, mapName: 'de_inferno', source: DemoSource.PerfectWorld, side: TeamNumber.T },
    );
    expect(scenario(result.analysis.tactics, 'trade-kill-round')).toMatchObject({
      frequency: { count: 1, total: 1, percentage: 100 },
      adr: 80,
      evidence: [{ checksum: 'chosen', side: TeamNumber.T, roundNumber: 1 }],
    });
    expect(buildTacticalAnalysis([match('excluded', [round(1)], { ratingEligible: false })])).toEqual(
      buildTacticalAnalysis([]),
    );
  });

  it('returns stable bounded replay evidence without changing inputs or fabricating event ticks', () => {
    const entries = [
      match('older', [round(1, { tradeKills: 1 })], { date: '2025-01-01T00:00:00.000Z' }),
      match(
        'newer',
        [8, 2, 4, 1, 7, 6, 3, 5].map((number) => round(number, { tradeKills: 1 })),
      ),
    ];
    const original = structuredClone(entries);
    const result = buildTacticalAnalysis(entries);
    const trade = scenario(result, 'trade-kill-round');
    expect(trade.frequency).toMatchObject({ count: 9, total: 9 });
    expect(trade.evidence.map((item) => [item.checksum, item.roundNumber, item.tick])).toEqual([
      ['newer', 1, 1000],
      ['newer', 2, 2000],
      ['newer', 3, 3000],
      ['newer', 4, 4000],
      ['newer', 5, 5000],
      ['newer', 6, 6000],
    ]);
    expect(buildTacticalAnalysis(entries.toReversed())).toEqual(result);
    expect(entries).toEqual(original);
    const unreplayable = buildTacticalAnalysis([
      match('broken-tick', [round(1, { tradeKills: 1, startTick: Number.NaN })]),
      match('broken-round', [round(0, { tradeKills: 1 })]),
    ]);
    expect(scenario(unreplayable, 'trade-kill-round')).toMatchObject({
      frequency: { count: 2, total: 2 },
      evidence: [],
    });
  });

  it('reserves winning and losing examples before filling unused places in the original stable order', () => {
    const recentWins = match(
      'recent',
      Array.from({ length: 8 }, (_, index) => round(index + 1, { tradeKills: 1, won: true })),
    );
    const earlierLosses = match(
      'earlier',
      Array.from({ length: 4 }, (_, index) => round(index + 1, { tradeKills: 1 })),
      { date: '2025-12-01T00:00:00.000Z' },
    );
    const entries = [earlierLosses, recentWins];
    const original = structuredClone(entries);
    const result = buildTacticalAnalysis(entries);
    const trade = scenario(result, 'trade-kill-round');
    expect(trade).toMatchObject({ frequency: { count: 12, total: 12 }, wins: 8 });
    expect(trade.evidence.map((item) => [item.checksum, item.roundNumber, item.won])).toEqual([
      ['recent', 1, true],
      ['recent', 2, true],
      ['recent', 3, true],
      ['earlier', 1, false],
      ['earlier', 2, false],
      ['earlier', 3, false],
    ]);
    expect(buildTacticalAnalysis(entries.toReversed())).toEqual(result);
    expect(entries).toEqual(original);

    const oneLoss = { ...earlierLosses, rounds: earlierLosses.rounds.slice(0, 1) };
    const filled = scenario(buildTacticalAnalysis([oneLoss, recentWins]), 'trade-kill-round');
    expect(filled.evidence.map((item) => [item.checksum, item.roundNumber, item.won])).toEqual([
      ['recent', 1, true],
      ['recent', 2, true],
      ['recent', 3, true],
      ['recent', 4, true],
      ['recent', 5, true],
      ['earlier', 1, false],
    ]);
    const onlyWins = scenario(buildTacticalAnalysis([recentWins]), 'trade-kill-round');
    expect(onlyWins.evidence.map((item) => item.roundNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
