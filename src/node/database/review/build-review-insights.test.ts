import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, EconomyType, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import type { ReviewTrainingScope } from 'csdm/common/types/review-insights';
import { buildReviewInsights } from './build-review-insights';

const steamId = '76561198000000001';
function round(roundNumber: number, changes: Partial<PersonalRoundStats> = {}): PersonalRoundStats {
  return {
    roundNumber,
    startTick: roundNumber * 1000,
    openingKillTick: null,
    openingDeathTick: null,
    deathTick: null,
    teamFlashTick: null,
    clutchTick: null,
    side: TeamNumber.T,
    won: true,
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
    moneySpent: 1000,
    rws: 20,
    weapons: [],
    ...changes,
  };
}

function match(
  checksum: string,
  rounds: PersonalRoundStats[],
  changes: Partial<PersonalMatchStats> = {},
): PersonalMatchStats {
  return {
    checksum,
    steamId,
    name: 'Fixture',
    date: '2026-01-01T12:00:00.000Z',
    mapName: 'de_inferno',
    source: DemoSource.PerfectWorld,
    gameMode: GameMode.Casual,
    buildNumber: 1,
    tickrate: 64,
    result: 'win',
    ratingEligible: true,
    ratingEligibilityBasis: 'observed-5v5',
    demoRoundCount: rounds.length,
    rounds,
    ...changes,
  };
}

function history(count: number) {
  return Array.from({ length: count }, (_, index) =>
    match(
      String(index + 1),
      Array.from({ length: 10 }, (_, number) =>
        round(number + 1, { damage: index < count / 2 ? 40 : 80, kills: 1, headshotKills: index < count / 2 ? 0 : 1 }),
      ),
      { date: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00.000Z` },
    ),
  );
}

describe('descriptive personal style', () => {
  it('pools actual numerator/denominator instead of averaging matches or inventing scores', () => {
    const data = [
      match('a', [round(1, { openingKill: true, kills: 1, tradeKills: 1, flashesThrown: 1, survived: false })]),
      match(
        'b',
        Array.from({ length: 9 }, (_, index) => round(index + 1, { kills: index === 0 ? 3 : 0 })),
      ),
    ];
    const result = buildReviewInsights(data, { steamId });
    expect(result.style.find((item) => item.id === 'opening-participation')).toMatchObject({
      numerator: 1,
      denominator: 10,
      percentage: 10,
    });
    expect(result.style.find((item) => item.id === 'trade-kill-share')).toMatchObject({
      numerator: 1,
      denominator: 4,
      percentage: 25,
    });
    expect(result.style.find((item) => item.id === 'utility-round-share')?.percentage).toBe(10);
    expect(result.style.find((item) => item.id === 'survival')?.percentage).toBe(90);
    expect(result.style.every((item) => item.sampleStatus === 'limited')).toBe(true);
  });

  it('deduplicates demos and keeps accounts, maps, sources and side selection isolated', () => {
    const a = match('a', [round(1), round(2, { side: TeamNumber.CT })]);
    const other = match('b', [round(1)], { steamId: '76561198000000002' });
    const result = buildReviewInsights([a, a, other], { steamId, side: TeamNumber.CT });
    expect(result).toMatchObject({ matchCount: 1, roundCount: 1 });
    expect(result.comparisons[0].side).toBe(TeamNumber.CT);
    expect(buildReviewInsights([a], { steamId, source: DemoSource.Valve }).roundCount).toBe(0);
    expect(buildReviewInsights([a], { steamId, mapName: 'de_nuke' }).roundCount).toBe(0);
  });

  it('keeps no opportunities missing and does not label an absent side as missing data', () => {
    const result = buildReviewInsights([match('a', [round(1)])], { steamId, side: TeamNumber.CT });
    expect(result.style.every((item) => item.percentage === null)).toBe(true);
    expect(result.cards).toEqual([]);
    expect(result.comparisons).toEqual([]);
    expect(result.coverage).toMatchObject({ analyzedMatches: 1, skippedMatches: 0, roundsWithReviewEvidence: 0 });
    const empty = buildReviewInsights([match('a', [])], { steamId }, 1);
    expect(empty.coverage.skippedMatches).toBe(1);
  });
});

describe('review candidates and evidence', () => {
  it('locates the relevant event with eight seconds of context and does not replay before the round', () => {
    const result = buildReviewInsights(
      [
        match('a', [
          round(1, {
            openingDeath: true,
            openingDeathTick: 2000,
            deathTick: 2000,
            deaths: 1,
            teammatesFlashed: 1,
            teamFlashTick: 1200,
            clutchOpponents: 2,
            clutchTick: 1400,
          }),
          round(2, { openingKill: true, openingKillTick: 2700, won: false }),
        ]),
      ],
      { steamId },
    );
    expect(result.cards.find((card) => card.id === 'opening-deaths')?.evidence[0]).toMatchObject({
      tick: 1488,
      eventTick: 2000,
      precision: 'event-context',
    });
    expect(result.cards.find((card) => card.id === 'untraded-deaths')?.evidence[0].eventTick).toBe(2000);
    expect(result.cards.find((card) => card.id === 'team-flashes')?.evidence[0]).toMatchObject({
      tick: 1000,
      eventTick: 1200,
    });
    expect(result.cards.find((card) => card.id === 'lost-clutches')?.evidence[0].eventTick).toBe(1400);
    expect(result.cards.find((card) => card.id === 'opening-advantage-lost')?.evidence[0].tick).toBe(2188);
    expect(result.coverage.evidencePrecision).toBe('event-context');
  });

  it('falls back for missing clock/event data and cannot pinpoint the untraded death in a respawn round', () => {
    const result = buildReviewInsights(
      [
        match('a', [round(1, { openingDeath: true, openingDeathTick: 1400 })], { tickrate: 0 }),
        match('b', [round(1, { deaths: 2, tradedDeaths: 1, deathTick: 1400 })]),
        match('c', [round(1, { teammatesFlashed: 1, teamFlashTick: 1400 })]),
      ],
      { steamId },
    );
    expect(result.cards.find((card) => card.id === 'opening-deaths')?.evidence[0]).toMatchObject({
      precision: 'round-start',
      tick: 1000,
      eventTick: 1400,
    });
    expect(result.cards.find((card) => card.id === 'untraded-deaths')?.evidence[0]).toMatchObject({
      precision: 'round-start',
      eventTick: null,
    });
    expect(result.coverage.evidencePrecision).toBe('mixed');
  });

  it('uses a distinct and explicit opportunity denominator for each topic', () => {
    const result = buildReviewInsights(
      [
        match('a', [
          round(1, {
            openingKill: true,
            won: false,
            deaths: 1,
            survived: false,
            flashesThrown: 2,
            teammatesFlashed: 3,
          }),
          round(2, {
            openingDeath: true,
            deaths: 1,
            tradedDeaths: 1,
            survived: false,
            clutchOpponents: 2,
            clutchWon: false,
          }),
          round(3, { flashesThrown: 1 }),
        ]),
      ],
      { steamId },
    );
    expect(result.cards.find((card) => card.id === 'opening-deaths')).toMatchObject({
      occurrenceCount: 1,
      denominator: 2,
      denominatorKind: 'opening-duels',
      percentage: 50,
    });
    expect(result.cards.find((card) => card.id === 'opening-advantage-lost')).toMatchObject({
      occurrenceCount: 1,
      denominator: 1,
      percentage: 100,
    });
    expect(result.cards.find((card) => card.id === 'untraded-deaths')).toMatchObject({
      occurrenceCount: 1,
      denominator: 2,
      percentage: 50,
    });
    expect(result.cards.find((card) => card.id === 'team-flashes')).toMatchObject({
      occurrenceCount: 1,
      denominator: 2,
      percentage: 50,
    });
    expect(result.cards.find((card) => card.id === 'lost-clutches')).toMatchObject({
      occurrenceCount: 1,
      denominator: 1,
    });
    expect(result.cards.flatMap((card) => card.evidence).every((item) => item.precision === 'round-start')).toBe(true);
  });

  it('caps links without truncating trigger counts and skips invalid replay timestamps', () => {
    const entries = history(8).map((item, index) => ({
      ...item,
      rounds: [round(1, { openingDeath: true, startTick: index === 7 ? Number.NaN : 1000 + index })],
    }));
    const result = buildReviewInsights(entries, { steamId });
    const card = result.cards.find((item) => item.id === 'opening-deaths')!;
    expect(card).toMatchObject({ occurrenceCount: 8, denominator: 8, evidenceTotal: 7 });
    expect(card.evidence).toHaveLength(6);
    expect(card.evidence[0]).toMatchObject({ checksum: '7', tick: 1006, roundNumber: 1, steamId });
    expect(result.coverage.roundsWithReviewEvidence).toBe(7);
  });

  it('handles a flash exposure without its throw event without producing a zero denominator', () => {
    const result = buildReviewInsights([match('a', [round(1, { teammatesFlashed: 1 })])], { steamId });
    expect(result.cards[0]).toMatchObject({ id: 'team-flashes', denominator: 1, occurrenceCount: 1 });
    expect(result.style.find((item) => item.id === 'utility-round-share')?.numerator).toBe(0);
  });
});

describe('training comparison', () => {
  const scope: ReviewTrainingScope = {
    cardId: 'opening-deaths',
    startedAt: '2026-01-02T12:00:00.000Z',
    mapName: 'de_inferno',
    side: TeamNumber.T,
    source: DemoSource.PerfectWorld,
    gameMode: GameMode.Casual,
    buildNumber: 1,
  };
  function samples(count = 4) {
    return history(count).map((entry, index) => ({
      ...entry,
      rounds: entry.rounds.map((item) => ({
        ...item,
        openingDeath: index < 2,
        openingKill: index >= 2,
      })),
    }));
  }

  it('uses actual match dates, counts boundary dates as earlier, and is independent of current page filters', () => {
    const entries = samples();
    const result = buildReviewInsights(entries.toReversed(), {
      steamId,
      mapName: 'de_nuke',
      side: TeamNumber.CT,
      source: DemoSource.Valve,
      training: scope,
    });
    expect(result.roundCount).toBe(0);
    expect(result.training).toMatchObject({
      scope,
      sampleStatus: 'ready',
      earlier: { occurrenceCount: 20, denominator: 20, percentage: 100, matchCount: 2, roundCount: 20 },
      recent: { occurrenceCount: 0, denominator: 20, percentage: 0, matchCount: 2, roundCount: 20 },
    });
    // Reimporting an old demo only deduplicates its checksum; it cannot become a post-training match.
    expect(buildReviewInsights([...entries, entries[0]], { steamId, training: scope }).training).toEqual(
      result.training,
    );
  });

  it('keeps cohorts strict and requires match, round, and event opportunity samples separately', () => {
    const entries = samples();
    const variants: Partial<PersonalMatchStats>[] = [
      { mapName: 'de_nuke' },
      { source: DemoSource.Valve },
      { gameMode: GameMode.Competitive },
      { buildNumber: 2 },
      { steamId: '76561198000000002' },
      { rounds: entries[3].rounds.map((item) => ({ ...item, side: TeamNumber.CT })) },
    ];
    const result = buildReviewInsights(
      [
        ...entries,
        ...variants.map((change, index) => ({
          ...entries[3],
          ...change,
          checksum: `variant${index}`,
        })),
      ],
      { steamId, training: scope },
    );
    expect(result.training?.recent.matchCount).toBe(2);
    const sparse = entries.map((entry) => ({
      ...entry,
      rounds: entry.rounds.map((item, index) => ({
        ...item,
        openingDeath: index === 0,
        openingKill: false,
      })),
    }));
    expect(buildReviewInsights(sparse, { steamId, training: scope }).training).toMatchObject({
      sampleStatus: 'insufficient',
      recent: { denominator: 2, roundCount: 20 },
    });
    expect(buildReviewInsights(entries.slice(0, 3), { steamId, training: scope }).training?.sampleStatus).toBe(
      'insufficient',
    );
  });

  it('caps both periods at five matches and distinguishes missing opportunities from zero occurrences', () => {
    const training = { ...scope, startedAt: '2026-01-06T12:00:00.000Z', cardId: 'lost-clutches' as const };
    const result = buildReviewInsights(samples(12), { steamId, training }).training!;
    expect(result.earlier).toMatchObject({ matchCount: 5, roundCount: 50, denominator: 0, percentage: null });
    expect(result.recent).toMatchObject({ matchCount: 5, roundCount: 50, denominator: 0, percentage: null });
    expect(result.sampleStatus).toBe('insufficient');
    expect(buildReviewInsights([], { steamId }).training).toBeNull();
    expect(() => buildReviewInsights([], { steamId, training: { ...scope, startedAt: 'invalid' } })).toThrow();
  });
});

describe('matched earlier/recent comparisons', () => {
  it('compares whole, disjoint matches within one cohort using pooled rates and percentage points', () => {
    const result = buildReviewInsights(history(4), { steamId });
    const comparison = result.comparisons[0];
    expect(comparison).toMatchObject({
      sampleStatus: 'ready',
      earlier: { matchCount: 2, roundCount: 20 },
      recent: { matchCount: 2, roundCount: 20 },
    });
    expect(comparison.earlier.endDate! < comparison.recent.startDate!).toBe(true);
    expect(comparison.metrics.find((metric) => metric.id === 'adr')).toMatchObject({
      sampleStatus: 'ready',
      earlier: { value: 40 },
      recent: { value: 80 },
      delta: 40,
    });
    expect(comparison.metrics.find((metric) => metric.id === 'headshot-rate')).toMatchObject({
      unit: 'percent',
      delta: 100,
    });
    expect(comparison.metrics.find((metric) => metric.id === 'opening-conversion')).toMatchObject({
      sampleStatus: 'insufficient',
      delta: null,
    });
  });

  it('does not compare across maps, sides, builds, modes or sources', () => {
    const entries = history(4);
    const variants: Partial<PersonalMatchStats>[] = [
      { mapName: 'de_nuke' },
      { buildNumber: 2 },
      { gameMode: GameMode.Competitive },
      { source: DemoSource.Valve },
    ];
    const all = [
      entries[0],
      ...variants.map((change, index) => ({ ...entries[1], ...change, checksum: `v${index}` })),
      { ...entries[2], rounds: entries[2].rounds.map((item) => ({ ...item, side: TeamNumber.CT })) },
    ];
    const result = buildReviewInsights(all, { steamId });
    expect(result.comparisons).toHaveLength(6);
    expect(result.comparisons.every((item) => item.sampleStatus === 'insufficient')).toBe(true);
    expect(new Set(result.comparisons.map((item) => item.key)).size).toBe(6);
  });

  it('keeps small samples visible but suppresses all comparative deltas', () => {
    const result = buildReviewInsights(history(3), { steamId });
    expect(result.comparisons[0]).toMatchObject({
      sampleStatus: 'insufficient',
      earlier: { matchCount: 1 },
      recent: { matchCount: 2 },
    });
    expect(result.comparisons[0].metrics.every((item) => item.delta === null)).toBe(true);
    const short = buildReviewInsights(
      history(4).map((item) => ({ ...item, rounds: item.rounds.slice(0, 2) })),
      { steamId },
    );
    expect(short.comparisons[0].sampleStatus).toBe('insufficient');
  });

  it('uses only the last ten whole matches with at most five per window', () => {
    const result = buildReviewInsights(history(12), { steamId });
    expect(result.comparisons[0]).toMatchObject({
      availableMatchCount: 12,
      earlier: { matchCount: 5, startDate: '2026-01-03T12:00:00.000Z' },
      recent: { matchCount: 5, startDate: '2026-01-08T12:00:00.000Z' },
    });
  });
});
