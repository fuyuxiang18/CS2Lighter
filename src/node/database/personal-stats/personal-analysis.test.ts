import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, EconomyType, GameMode, TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import { aggregatePersonalStats } from './aggregate-personal-stats';

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
    name: 'Fixture',
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

describe('derived personal analysis from existing cached facts', () => {
  it('returns missing ratios for an empty scope without fabricating observations or achievements', () => {
    const result = aggregatePersonalStats([], { steamId });
    expect(result.knownResultMatchCount).toBe(0);
    expect(result.analysis.scope).toEqual({
      matchCount: 0,
      roundCount: 0,
      excludedMatchCount: 0,
      excludedRoundCount: 0,
      knownResultMatchCount: 0,
    });
    expect(result.analysis.output.killRounds).toEqual({ count: 0, total: 0, percentage: null });
    expect(result.analysis.utility.damagePerHeOrFire.value).toBeNull();
    expect(result.analysis.findings).toEqual([]);
    expect(result.analysis.achievements).toEqual([]);
    expect(result.analysis.stability.adrMedian).toBeNull();
    expect(result.analysis.trend.recent).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('pools rounds instead of averaging match percentages and isolates advanced analysis from nonstandard matches', () => {
    const short = match('short', [round(1, { kills: 2, damage: 200, utilityDamage: 50, rws: 80 })]);
    const long = match(
      'long',
      Array.from({ length: 3 }, (_, index) => round(index + 1, { damage: 20 })),
    );
    const custom = match('custom', [round(1, { kills: 20, damage: 2000, rws: 100 })], {
      ratingEligible: false,
      gameMode: GameMode.Deathmatch,
    });
    const result = aggregatePersonalStats([short, long, custom, short, { ...short, steamId: 'other' }], { steamId });
    expect(result.metrics.damage).toBe(2260);
    expect(result.metrics.rws).toBe(20);
    expect(result.metrics.rwsRoundCount).toBe(4);
    expect(result.metrics.rwsMissingRoundCount).toBe(1);
    expect(result.analysis.scope).toMatchObject({
      matchCount: 2,
      roundCount: 4,
      excludedMatchCount: 1,
      excludedRoundCount: 1,
    });
    expect(result.analysis.output.killRounds).toEqual({ count: 1, total: 4, percentage: 25 });
    expect(result.analysis.output.nonUtilityDamage).toEqual({ total: 210, samples: 4, value: 52.5 });
    expect(result.analysis.achievements).toEqual([]);
  });

  it('keeps independent economic coverage rather than discarding one known field because the other is missing', () => {
    const result = aggregatePersonalStats(
      [
        match('a', [
          round(1, { equipmentValue: 5000, moneySpent: null }),
          round(2, { equipmentValue: null, moneySpent: 2000 }),
          round(3, { equipmentValue: 3000, moneySpent: 0 }),
        ]),
      ],
      { steamId },
    );
    expect(result.metrics).toMatchObject({
      economyRoundCount: 1,
      equipmentRoundCount: 2,
      moneySpentRoundCount: 2,
      equipmentValue: 8000,
      moneySpent: 2000,
      averageEquipmentValue: 4000,
      averageMoneySpent: 1000,
    });
  });

  it('preserves complete match results under round/side filters and excludes unknown results from the denominator', () => {
    const result = aggregatePersonalStats(
      [
        match('win', [round(1), round(2, { won: true, side: TeamNumber.CT })]),
        match('tie', [round(1)], { result: 'tie' }),
        match('unknown', [round(1)], { result: 'unknown' }),
        match('elsewhere', [round(1)], { result: 'loss', mapName: 'de_nuke' }),
      ],
      { steamId, mapName: 'de_inferno', side: TeamNumber.T },
    );
    expect(result).toMatchObject({ matchCount: 3, knownResultMatchCount: 2, matchWins: 1, matchWinPercentage: 50 });
    expect(result.analysis.byRoundResult).toHaveLength(1);
    expect(result.analysis.byRoundResult[0]).toMatchObject({
      key: 'loss',
      matchWins: 1,
      knownResultMatchCount: 2,
      matchWinPercentage: 50,
      metrics: { roundWinPercentage: 0 },
    });
    expect(result.analysis.byMatchResult.find((group) => group.key === 'unknown')?.matchWinPercentage).toBeNull();
  });

  it('uses deaths, won rounds and lost rounds as separate survival denominators', () => {
    const result = aggregatePersonalStats(
      [
        match('a', [
          round(1, { won: true, survived: true }),
          round(2, { won: true, survived: false, deaths: 1, tradedDeaths: 1, assists: 1 }),
          round(3, { survived: false, deaths: 1, damage: 0 }),
          round(4, { survived: true, damage: 30 }),
        ]),
      ],
      { steamId },
    ).analysis;
    expect(result.survival.survivedWinRounds).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(result.survival.survivedLossRounds).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(result.survival.untradedDeathRounds).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(result.survival.noImpactDeathRounds).toEqual({ count: 1, total: 2, percentage: 50 });
    expect(result.output.killOrAssistRounds.count).toBe(1);
  });

  it('pools utility effects per throw, keeps zero throws missing, and never derives accuracy from damage events or shots', () => {
    const result = aggregatePersonalStats(
      [
        match('a', [
          round(1, {
            damage: 70,
            utilityDamage: 70,
            heThrown: 1,
            flashesThrown: 1,
            enemyBlindSeconds: 4,
            enemiesFlashed: 2,
            teammatesFlashed: 1,
          }),
          round(2, { damage: 30, utilityDamage: 30, fireThrown: 1, flashesThrown: 3, flashAssists: 1 }),
          round(3, {
            damage: 110,
            weapons: [{ weapon: WeaponName.AK47, kills: 1, headshotKills: 1, damage: 110, shots: 2 }],
          }),
        ]),
      ],
      { steamId },
    );
    expect(result.analysis.utility.damagePerHeOrFire).toEqual({ total: 100, samples: 2, value: 50 });
    expect(result.analysis.utility.enemiesPerFlash).toEqual({ total: 2, samples: 4, value: 0.5 });
    expect(result.analysis.utility.blindSecondsPerFlash.value).toBe(1);
    expect(result.analysis.utility.teammateFlashRounds).toEqual({ count: 1, total: 3, percentage: 100 / 3 });
    expect(result.weapons).toEqual([{ weapon: WeaponName.AK47, kills: 1, headshotKills: 1, damage: 110, shots: 2 }]);
    expect(result.weapons[0]).not.toHaveProperty('accuracy');
    const noThrow = aggregatePersonalStats([match('b', [round(1, { utilityDamage: 30 })])], { steamId });
    expect(noThrow.analysis.utility.damagePerHeOrFire).toEqual({ total: 30, samples: 0, value: null });
  });

  it('classifies regulation halves and overtime from original rounds even when only one side is selected', () => {
    const original = match(
      'a',
      Array.from({ length: 27 }, (_, index) =>
        round(index + 1, {
          side: index < 12 || index >= 24 ? TeamNumber.T : TeamNumber.CT,
        }),
      ),
    );
    const ct = aggregatePersonalStats([original], { steamId, side: TeamNumber.CT });
    expect(ct.analysis.byPhase.map((group) => [group.key, group.metrics.roundCount])).toEqual([['second-half', 12]]);
    const t = aggregatePersonalStats([original], { steamId, side: TeamNumber.T });
    expect(t.analysis.byPhase.map((group) => [group.key, group.metrics.roundCount])).toEqual([
      ['first-half', 12],
      ['overtime', 3],
    ]);
    const mr15 = match(
      'mr15',
      Array.from({ length: 31 }, (_, index) => round(index + 1, { side: index < 15 ? TeamNumber.T : TeamNumber.CT })),
    );
    expect(
      aggregatePersonalStats([mr15], { steamId }).analysis.byPhase.map((group) => [
        group.key,
        group.metrics.roundCount,
      ]),
    ).toEqual([
      ['first-half', 15],
      ['overtime', 1],
      ['second-half', 15],
    ]);
  });

  it('does not guess halves for missing early rounds or nonstandard team changes', () => {
    const full = Array.from({ length: 20 }, (_, index) =>
      round(index + 1, { side: index < 12 ? TeamNumber.T : TeamNumber.CT }),
    );
    for (const rounds of [
      full.slice(1),
      full.filter((entry) => entry.roundNumber !== 5),
      full.map((entry) => (entry.roundNumber === 8 ? { ...entry, side: TeamNumber.CT } : entry)),
    ]) {
      const result = aggregatePersonalStats([match('a', rounds)], { steamId });
      expect(result.analysis.byPhase.map((group) => group.key)).toEqual(['unclassified']);
    }
  });

  it('builds UTC months rather than grouping by the date string or machine timezone', () => {
    const result = aggregatePersonalStats(
      [match('a', [round(1)], { date: '2026-02-01T01:00:00+08:00' }), match('b', [round(1)], { date: 'invalid' })],
      { steamId },
    );
    expect(result.analysis.byMonth.map((group) => group.key)).toEqual(['2026-01', 'unknown']);
  });

  it('compares equal disjoint chronological windows and pools unequal match lengths', () => {
    const matches = Array.from({ length: 5 }, (_, index) =>
      match(
        String(index),
        Array.from({ length: index + 1 }, (_, number) => round(number + 1, { damage: index * 10 })),
        { date: `2026-01-0${index + 1}T00:00:00.000Z` },
      ),
    );
    const result = aggregatePersonalStats(matches, { steamId }).analysis;
    expect(result.trend.comparable).toBe(true);
    expect(result.trend.recent).toMatchObject({
      matchCount: 2,
      from: matches[3].date,
      to: matches[4].date,
      metrics: { roundCount: 9, damage: 320 },
    });
    expect(result.trend.previous).toMatchObject({
      matchCount: 2,
      from: matches[1].date,
      to: matches[2].date,
      metrics: { roundCount: 5, damage: 80 },
    });
    expect(result.trend.recent?.metrics.adr).toBeCloseTo(320 / 9);
    expect(result.stability).toEqual({ matchCount: 5, adrMedian: 20, adrP25: 10, adrP75: 30 });
    matches[4].mapName = 'de_nuke';
    expect(aggregatePersonalStats(matches, { steamId }).analysis.trend.comparable).toBe(false);
    expect(aggregatePersonalStats(matches.slice(0, 3), { steamId }).analysis.trend.recent).toBeNull();
  });

  it('breaks streaks at ties, unknown results, excluded games, round gaps and match boundaries', () => {
    const outcomes: PersonalMatchStats['result'][] = [
      'win',
      'win',
      'tie',
      'loss',
      'loss',
      'unknown',
      'win',
      'win',
      'win',
    ];
    const matches = outcomes.map((result, index) =>
      match(String(index), [round(1, { won: true }), round(2, { won: true }), round(4, { won: true })], {
        date: `2026-01-0${index + 1}T00:00:00.000Z`,
        result,
        ratingEligible: index !== 7,
      }),
    );
    expect(aggregatePersonalStats(matches, { steamId }).analysis.streaks).toEqual({
      longestMatchWins: 2,
      longestMatchLosses: 2,
      currentMatchResult: 'win',
      currentMatchCount: 1,
      longestRoundWins: 2,
      longestRoundLosses: 0,
    });
    matches[8].result = 'unknown';
    expect(aggregatePersonalStats(matches, { steamId }).analysis.streaks.currentMatchResult).toBeNull();
  });

  it('requires repeated events for findings and returns bounded real evidence at the relevant event', () => {
    const rounds = Array.from({ length: 20 }, (_, index) =>
      round(index + 1, {
        openingKill: index < 5,
        openingKillTick: index < 5 ? (index + 1) * 1000 + 500 : null,
        won: index >= 3,
        deaths: 1,
        survived: false,
        teammatesFlashed: index < 2 ? 1 : 0,
        teamFlashTick: index < 2 ? (index + 1) * 1000 + 600 : null,
        deathTick: (index + 1) * 1000 + 700,
      }),
    );
    const result = aggregatePersonalStats([match('a', rounds)], { steamId }).analysis;
    expect(result.findings.find((entry) => entry.code === 'opening-conversion')).toMatchObject({
      kind: 'focus',
      count: 3,
      total: 5,
      evidence: [
        { checksum: 'a', roundNumber: 1, tick: 1244 },
        { checksum: 'a', roundNumber: 2, tick: 2244 },
        { checksum: 'a', roundNumber: 3, tick: 3244 },
      ],
    });
    expect(result.findings.find((entry) => entry.code === 'untraded-deaths')?.evidence).toHaveLength(3);
    expect(result.findings.find((entry) => entry.code === 'zero-utility')).toMatchObject({ count: 20, total: 20 });
    expect(aggregatePersonalStats([match('small', rounds.slice(0, 1))], { steamId }).analysis.findings).toEqual([]);
    expect(result.findings.every((entry) => entry.count <= entry.total)).toBe(true);
  });

  it('uses only actual event labels for fun records and excludes six-kill custom rounds', () => {
    const result = aggregatePersonalStats(
      [
        match('a', [
          round(1, { kills: 5 }),
          round(2, { kills: 4 }),
          round(3, {
            kills: 3,
            clutchOpponents: 3,
            clutchWon: true,
            clutchTick: 3600,
            weapons: [
              { weapon: WeaponName.HEGrenade, kills: 2, headshotKills: 0, damage: 120, shots: 0 },
              { weapon: WeaponName.Knife, kills: 1, headshotKills: 0, damage: 100, shots: 0 },
            ],
          }),
        ]),
        match('custom', [round(1, { kills: 6 })], { ratingEligible: false }),
      ],
      { steamId },
    ).analysis;
    expect(result.achievements.map((entry) => [entry.code, entry.count, entry.total])).toEqual([
      ['ace', 1, 3],
      ['four-kill', 1, 3],
      ['triple-kill', 1, 3],
      ['clutch-win', 1, 3],
      ['utility-multi-kill', 1, 3],
      ['knife-kill', 1, 3],
      ['clutch-1v3', 1, 3],
    ]);
    expect(result.achievements.find((entry) => entry.code === 'clutch-win')?.evidence[0].tick).toBe(3344);
  });

  it('uses exact thresholds and known equipment for extended event records, never shot count as kill count', () => {
    const result = aggregatePersonalStats(
      [
        match('a', [
          round(1, {
            kills: 3,
            damage: 300,
            tradeKills: 2,
            flashAssists: 2,
            equipmentValue: 2000,
            bombPlants: 1,
            weapons: [{ weapon: WeaponName.AWP, kills: 3, headshotKills: 0, damage: 300, shots: 6 }],
          }),
          round(2, { damage: 100, bombDefuses: 1 }),
          round(3, {
            damage: 99,
            tradeKills: 1,
            flashAssists: 1,
            kills: 2,
            equipmentValue: null,
            weapons: [{ weapon: WeaponName.AWP, kills: 1, headshotKills: 0, damage: 99, shots: 30 }],
          }),
          round(4, { kills: 2, equipmentValue: 2001 }),
        ]),
      ],
      { steamId },
    ).analysis;
    for (const code of [
      'damage-300',
      'damage-without-kill',
      'double-trade',
      'double-flash-assist',
      'awp-triple',
      'low-equipment-multi',
      'bomb-plant',
      'bomb-defuse',
    ]) {
      expect(result.achievements.find((entry) => entry.code === code)).toMatchObject({ count: 1, total: 4 });
    }
    expect(
      result.achievements.find((entry) => entry.code === 'awp-triple')?.evidence.map((entry) => entry.roundNumber),
    ).toEqual([1]);
  });

  it('keeps non-utility ADR nonnegative if a legacy fact has inconsistent utility damage', () => {
    const result = aggregatePersonalStats(
      [match('a', [round(1, { damage: 40, utilityDamage: 50 }), round(2, { damage: 80, utilityDamage: 20 })])],
      { steamId },
    );
    expect(result.analysis.output.nonUtilityDamage).toEqual({ total: 60, samples: 2, value: 30 });
  });
});
