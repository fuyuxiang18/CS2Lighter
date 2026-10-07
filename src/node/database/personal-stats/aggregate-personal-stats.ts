import { TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  FetchPersonalStatsPayload,
  PersonalMatchStats,
  PersonalStatsSummary,
  PersonalWeaponStats,
} from 'csdm/common/types/personal-stats';
import { buildPersonalAnalysis } from './build-personal-analysis';
import { calculatePersonalMetrics, groupMatches, percent } from './personal-metrics';
export { calculateHltvRating1 } from './personal-metrics';

export function aggregatePersonalStats(
  input: PersonalMatchStats[],
  payload: FetchPersonalStatsPayload,
  availableMatches?: number,
): PersonalStatsSummary {
  const all = [
    ...new Map(
      input.filter((match) => match.steamId === payload.steamId).map((match) => [match.checksum, match]),
    ).values(),
  ];
  const matches = all
    .filter(
      (match) =>
        (!payload.mapName || payload.mapName === match.mapName) && (!payload.source || payload.source === match.source),
    )
    .map((match) => ({
      ...match,
      rounds: match.rounds.filter((round) => payload.side === undefined || payload.side === round.side),
    }))
    .filter((match) => match.rounds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.checksum.localeCompare(b.checksum));
  const wins = matches.filter((match) => match.result === 'win').length;
  const losses = matches.filter((match) => match.result === 'loss').length;
  const ties = matches.filter((match) => match.result === 'tie').length;
  const weapons = new Map<string, PersonalWeaponStats>();
  const clutches = new Map<
    number,
    { opponents: number; attempts: number; wins: number; winPercentage: number | null }
  >();
  const cohorts = new Map<string, PersonalStatsSummary['cohorts'][number]>();
  for (const match of matches) {
    const key = JSON.stringify([match.mapName, match.buildNumber, match.gameMode, match.source]);
    const cohort = cohorts.get(key) ?? {
      mapName: match.mapName,
      buildNumber: match.buildNumber,
      gameMode: match.gameMode,
      source: match.source,
      matchCount: 0,
    };
    cohort.matchCount++;
    cohorts.set(key, cohort);
    for (const round of match.rounds) {
      for (const weapon of round.weapons) {
        const total = weapons.get(weapon.weapon) ?? {
          weapon: weapon.weapon,
          kills: 0,
          headshotKills: 0,
          damage: 0,
          shots: 0,
        };
        total.kills += weapon.kills;
        total.headshotKills += weapon.headshotKills;
        total.damage += weapon.damage;
        total.shots += weapon.shots;
        weapons.set(weapon.weapon, total);
      }
      if (round.clutchOpponents !== null) {
        const clutch = clutches.get(round.clutchOpponents) ?? {
          opponents: round.clutchOpponents,
          attempts: 0,
          wins: 0,
          winPercentage: null,
        };
        clutch.attempts++;
        clutch.wins += Number(round.clutchWon);
        clutch.winPercentage = percent(clutch.wins, clutch.attempts);
        clutches.set(round.clutchOpponents, clutch);
      }
    }
  }
  const available =
    availableMatches ??
    all.filter(
      (match) =>
        (!payload.mapName || payload.mapName === match.mapName) && (!payload.source || payload.source === match.source),
    ).length;
  const analyzed = all.filter(
    (match) =>
      match.rounds.length > 0 &&
      (!payload.mapName || payload.mapName === match.mapName) &&
      (!payload.source || payload.source === match.source),
  ).length;
  return {
    steamId: payload.steamId,
    matchCount: matches.length,
    matchWins: wins,
    matchLosses: losses,
    matchTies: ties,
    unknownResults: matches.length - wins - losses - ties,
    knownResultMatchCount: wins + losses + ties,
    matchWinPercentage: percent(wins, wins + losses + ties),
    metrics: calculatePersonalMetrics(matches),
    mapNames: [...new Set(all.map((match) => match.mapName))].sort(),
    byMap: groupMatches(matches, (match) => match.mapName),
    bySide: groupMatches(matches, (_match, round) => (round.side === TeamNumber.T ? 't' : 'ct')),
    byEconomy: groupMatches(matches, (_match, round) => round.economyType ?? 'unknown'),
    byClutchSize: [...clutches.values()].sort((a, b) => a.opponents - b.opponents),
    weapons: [...weapons.values()].sort((a, b) => b.kills - a.kills || a.weapon.localeCompare(b.weapon)),
    matches: matches.map(({ rounds, ...match }) => ({
      ...match,
      metrics: calculatePersonalMetrics([{ ...match, rounds }]),
      firstRound: rounds[0]?.roundNumber ?? null,
      firstTick: rounds[0]?.startTick ?? null,
    })),
    cohorts: [...cohorts.values()],
    coverage: {
      availableMatches: available,
      analyzedMatches: analyzed,
      skippedMatches: Math.max(0, available - analyzed),
    },
    methodology: { rating: 'hltv-1.0-public', rws: 'faceit-2025-public-local-v1', tradeWindowSeconds: 5 },
    analysis: buildPersonalAnalysis(matches, all),
  };
}
