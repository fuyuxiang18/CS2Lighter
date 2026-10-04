import { TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  FetchPersonalStatsPayload,
  PersonalMatchStats,
  PersonalMetrics,
  PersonalRoundStats,
  PersonalStatsGroup,
  PersonalStatsSummary,
  PersonalWeaponStats,
} from 'csdm/common/types/personal-stats';

function divide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function percent(numerator: number, denominator: number): number | null {
  return divide(100 * numerator, denominator);
}

/** HLTV's historical public Rating 1.0 formula, using pooled rounds, never the private 2.x/3.0 model. */
export function calculateHltvRating1(
  kills: number,
  survivedRounds: number,
  squaredKills: number,
  roundCount: number,
): number | null {
  if (roundCount <= 0) return null;
  return (
    (kills / roundCount / 0.679 + 0.7 * (survivedRounds / roundCount / 0.317) + squaredKills / roundCount / 1.277) / 2.7
  );
}

function calculatePersonalMetrics(matches: PersonalMatchStats[]): PersonalMetrics {
  const rounds = matches.flatMap((match) => match.rounds);
  const sum = (getValue: (round: PersonalRoundStats) => number) =>
    rounds.reduce((total, round) => total + getValue(round), 0);
  const roundCount = rounds.length;
  const roundWins = sum((round) => Number(round.won));
  const kills = sum((round) => round.kills);
  const deaths = sum((round) => round.deaths);
  const assists = sum((round) => round.assists);
  const headshotKills = sum((round) => round.headshotKills);
  const damage = sum((round) => round.damage);
  const utilityDamage = sum((round) => round.utilityDamage);
  const kastRoundCount = sum((round) => Number(round.kast));
  const survivedRoundCount = sum((round) => Number(round.survived));
  const ratingRounds = matches.filter((match) => match.ratingEligible).flatMap((match) => match.rounds);
  const rwsRounds = rounds.filter((round) => round.rws !== null);
  const openingKills = sum((round) => Number(round.openingKill));
  const openingDeaths = sum((round) => Number(round.openingDeath));
  const openingAttempts = openingKills + openingDeaths;
  const openingKillRoundWins = sum((round) => Number(round.openingKill && round.won));
  const tradedDeaths = sum((round) => round.tradedDeaths);
  const clutchAttempts = sum((round) => Number(round.clutchOpponents !== null));
  const clutchWins = sum((round) => Number(round.clutchWon));
  const flashesThrown = sum((round) => round.flashesThrown);
  const enemiesFlashed = sum((round) => round.enemiesFlashed);
  const economyRounds = rounds.filter((round) => round.equipmentValue !== null && round.moneySpent !== null);
  const equipmentValue = economyRounds.reduce((total, round) => total + (round.equipmentValue ?? 0), 0);
  const moneySpent = economyRounds.reduce((total, round) => total + (round.moneySpent ?? 0), 0);
  const multiKills: PersonalMetrics['multiKills'] = [0, 0, 0, 0, 0, 0];
  for (const round of rounds) multiKills[Math.min(round.kills, 5)]++;
  return {
    roundCount,
    roundWins,
    roundWinPercentage: percent(roundWins, roundCount),
    kills,
    deaths,
    assists,
    headshotKills,
    headshotPercentage: percent(headshotKills, kills),
    kd: divide(kills, deaths),
    kda: divide(kills + assists, deaths),
    killsPerRound: divide(kills, roundCount),
    deathsPerRound: divide(deaths, roundCount),
    damage,
    adr: divide(damage, roundCount),
    utilityDamage,
    utilityDamagePerRound: divide(utilityDamage, roundCount),
    friendlyDamage: sum((round) => round.friendlyDamage),
    kastRoundCount,
    kastPercentage: percent(kastRoundCount, roundCount),
    survivedRoundCount,
    survivalPercentage: percent(survivedRoundCount, roundCount),
    hltvRating1: calculateHltvRating1(
      ratingRounds.reduce((total, round) => total + round.kills, 0),
      ratingRounds.filter((round) => round.survived).length,
      ratingRounds.reduce((total, round) => total + round.kills ** 2, 0),
      ratingRounds.length,
    ),
    ratingRoundCount: ratingRounds.length,
    rws: divide(
      rwsRounds.reduce((total, round) => total + (round.rws ?? 0), 0),
      rwsRounds.length,
    ),
    rwsRoundCount: rwsRounds.length,
    rwsMissingRoundCount: roundCount - rwsRounds.length,
    openingKills,
    openingDeaths,
    openingAttempts,
    openingSuccessPercentage: percent(openingKills, openingAttempts),
    openingAttemptPercentage: percent(openingAttempts, roundCount),
    openingKillRoundWins,
    openingConversionPercentage: percent(openingKillRoundWins, openingKills),
    tradeKills: sum((round) => round.tradeKills),
    tradedDeaths,
    tradedDeathPercentage: percent(tradedDeaths, deaths),
    flashAssists: sum((round) => round.flashAssists),
    clutchAttempts,
    clutchWins,
    clutchWinPercentage: percent(clutchWins, clutchAttempts),
    multiKills,
    bombPlants: sum((round) => round.bombPlants),
    bombDefuses: sum((round) => round.bombDefuses),
    flashesThrown,
    smokesThrown: sum((round) => round.smokesThrown),
    heThrown: sum((round) => round.heThrown),
    fireThrown: sum((round) => round.fireThrown),
    decoysThrown: sum((round) => round.decoysThrown),
    enemiesFlashed,
    enemyBlindSeconds: sum((round) => round.enemyBlindSeconds),
    teammatesFlashed: sum((round) => round.teammatesFlashed),
    enemiesPerFlash: divide(enemiesFlashed, flashesThrown),
    equipmentValue,
    moneySpent,
    economyRoundCount: economyRounds.length,
    averageEquipmentValue: divide(equipmentValue, economyRounds.length),
    averageMoneySpent: divide(moneySpent, economyRounds.length),
  };
}

function groupMatches(
  matches: PersonalMatchStats[],
  getKey: (match: PersonalMatchStats, round: PersonalRoundStats) => string,
): PersonalStatsGroup[] {
  const groups = new Map<string, Map<string, PersonalMatchStats>>();
  for (const match of matches) {
    for (const round of match.rounds) {
      const key = getKey(match, round);
      const entries = groups.get(key) ?? new Map<string, PersonalMatchStats>();
      let entry = entries.get(match.checksum);
      if (!entry) {
        entry = { ...match, rounds: [] };
        entries.set(match.checksum, entry);
      }
      entry.rounds.push(round);
      groups.set(key, entries);
    }
  }
  return Array.from(groups, ([key, entries]) => {
    const values = [...entries.values()];
    const matchWins = values.filter((match) => match.result === 'win').length;
    return {
      key,
      matchCount: entries.size,
      matchWins,
      matchWinPercentage: percent(matchWins, values.filter((match) => match.result !== 'unknown').length),
      metrics: calculatePersonalMetrics(values),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

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
  };
}
