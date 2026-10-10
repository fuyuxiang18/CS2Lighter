import { WeaponName } from 'csdm/common/types/counter-strike';
import type {
  PersonalAnalysis,
  PersonalAnalysisEvidence,
  PersonalAverage,
  PersonalRate,
} from 'csdm/common/types/personal-analysis';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import { calculatePersonalMetrics, groupMatches } from './personal-metrics';
import { buildTacticalAnalysis } from './build-tactical-analysis';

type Entry = { match: PersonalMatchStats; round: PersonalRoundStats };
type Predicate = (round: PersonalRoundStats) => boolean;

function rate(count: number, total: number): PersonalRate {
  return { count, total, percentage: total > 0 ? (100 * count) / total : null };
}

function average(total: number, samples: number): PersonalAverage {
  return { total, samples, value: samples > 0 ? total / samples : null };
}

function utilityCount(round: PersonalRoundStats): number {
  return round.flashesThrown + round.smokesThrown + round.heThrown + round.fireThrown + round.decoysThrown;
}

function evidence(
  entries: Entry[],
  getTick?: (round: PersonalRoundStats) => number | null,
): PersonalAnalysisEvidence[] {
  return entries.slice(0, 3).map(({ match, round }) => ({
    checksum: match.checksum,
    mapName: match.mapName,
    roundNumber: round.roundNumber,
    tick: Math.max(round.startTick, Math.round((getTick?.(round) ?? round.startTick) - 4 * match.tickrate)),
    side: round.side,
  }));
}

/** Do not infer a half from the selected side: classification uses the original unfiltered match. */
function inferHalfLength(match: PersonalMatchStats): number | null {
  const rounds = match.rounds.toSorted((a, b) => a.roundNumber - b.roundNumber);
  if (rounds[0]?.roundNumber !== 1) return null;
  const initialSide = rounds[0].side;
  const switchRound = rounds.find((round) => round.side !== initialSide)?.roundNumber;
  if (switchRound !== 13 && switchRound !== 16) return null;
  const half = switchRound - 1;
  // Missing early rounds or a player changing teams must not masquerade as a regulation side switch.
  for (let number = 1; number <= switchRound; number++) {
    if (!rounds.some((round) => round.roundNumber === number)) return null;
  }
  if (
    rounds.some(
      (round) =>
        round.roundNumber <= 2 * half &&
        round.side !==
          (round.roundNumber <= half ? initialSide : rounds.find((entry) => entry.roundNumber === switchRound)!.side),
    )
  )
    return null;
  return half;
}

function buildTrend(matches: PersonalMatchStats[]): PersonalAnalysis['trend'] {
  const dated = matches.filter((match) => Number.isFinite(Date.parse(match.date)));
  if (dated.length < 4) return { recent: null, previous: null, comparable: false };
  const size = Math.min(5, Math.floor(dated.length / 2));
  const selected = dated.slice(0, size * 2);
  const window = (values: PersonalMatchStats[]) => ({
    matchCount: values.length,
    metrics: calculatePersonalMetrics(values),
    from: values.at(-1)!.date,
    to: values[0].date,
  });
  const cohorts = new Set(
    selected.map((match) => JSON.stringify([match.mapName, match.source, match.gameMode, match.buildNumber])),
  );
  return {
    recent: window(selected.slice(0, size)),
    previous: window(selected.slice(size)),
    comparable: cohorts.size === 1,
  };
}

function quantile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const offset = (sorted.length - 1) * fraction;
  const lower = Math.floor(offset);
  const upper = Math.ceil(offset);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (offset - lower);
}

function buildStreaks(selected: PersonalMatchStats[]): PersonalAnalysis['streaks'] {
  const result: PersonalAnalysis['streaks'] = {
    longestMatchWins: 0,
    longestMatchLosses: 0,
    currentMatchResult: null,
    currentMatchCount: 0,
    longestRoundWins: 0,
    longestRoundLosses: 0,
  };
  let wins = 0;
  let losses = 0;
  // Nonstandard games, ties and unknown results break a match streak instead of being silently skipped.
  for (const match of selected.toReversed()) {
    const eligible = match.ratingEligible && Number.isFinite(Date.parse(match.date));
    wins = eligible && match.result === 'win' ? wins + 1 : 0;
    losses = eligible && match.result === 'loss' ? losses + 1 : 0;
    result.longestMatchWins = Math.max(result.longestMatchWins, wins);
    result.longestMatchLosses = Math.max(result.longestMatchLosses, losses);
    result.currentMatchResult = wins > 0 ? 'win' : losses > 0 ? 'loss' : null;
    result.currentMatchCount = Math.max(wins, losses);
    if (!eligible) continue;
    let roundWins = 0;
    let roundLosses = 0;
    let previousRound = 0;
    for (const round of match.rounds.toSorted((a, b) => a.roundNumber - b.roundNumber)) {
      if (round.roundNumber !== previousRound + 1) {
        roundWins = 0;
        roundLosses = 0;
      }
      roundWins = round.won ? roundWins + 1 : 0;
      roundLosses = round.won ? 0 : roundLosses + 1;
      result.longestRoundWins = Math.max(result.longestRoundWins, roundWins);
      result.longestRoundLosses = Math.max(result.longestRoundLosses, roundLosses);
      previousRound = round.roundNumber;
    }
  }
  return result;
}

function buildFindings(entries: Entry[]): PersonalAnalysis['findings'] {
  const findings: PersonalAnalysis['findings'] = [];
  const select = (predicate: Predicate) => entries.filter(({ round }) => predicate(round));
  const opening = select((round) => round.openingKill);
  const lostOpening = opening.filter(({ round }) => !round.won);
  const deaths = select((round) => round.deaths > 0);
  const untraded = deaths.filter(({ round }) => round.tradedDeaths === 0);
  const teamFlash = select((round) => round.teammatesFlashed > 0);
  const zeroUtility = select((round) => utilityCount(round) === 0);
  const multiKill = select((round) => round.kills >= 2);
  const clutches = select((round) => round.clutchOpponents !== null);
  const wonClutches = clutches.filter(({ round }) => round.clutchWon);
  const flashAssists = select((round) => round.flashAssists > 0);
  const add = (
    code: PersonalAnalysis['findings'][number]['code'],
    kind: 'focus' | 'strength',
    matches: Entry[],
    total: number,
    getTick?: (round: PersonalRoundStats) => number | null,
  ) => {
    findings.push({ code, kind, count: matches.length, total, evidence: evidence(matches, getTick) });
  };
  if (opening.length >= 5 && lostOpening.length >= 2)
    add('opening-conversion', 'focus', lostOpening, opening.length, (round) => round.openingKillTick);
  if (deaths.length >= 10 && untraded.length >= deaths.length / 2)
    add('untraded-deaths', 'focus', untraded, deaths.length, (round) => round.deathTick);
  if (teamFlash.length >= 2) add('team-flashes', 'focus', teamFlash, entries.length, (round) => round.teamFlashTick);
  if (entries.length >= 20 && zeroUtility.length >= 10 && zeroUtility.length >= entries.length * 0.4)
    add('zero-utility', 'focus', zeroUtility, entries.length);
  if (multiKill.length >= 3) add('multi-kill-rounds', 'strength', multiKill, entries.length);
  if (clutches.length >= 3 && wonClutches.length >= 2)
    add('clutch-wins', 'strength', wonClutches, clutches.length, (round) => round.clutchTick);
  if (flashAssists.length >= 2) add('flash-assists', 'strength', flashAssists, entries.length);
  return findings;
}

function buildAchievements(entries: Entry[]): PersonalAnalysis['achievements'] {
  const definitions: {
    code: PersonalAnalysis['achievements'][number]['code'];
    predicate: Predicate;
    getTick?: (round: PersonalRoundStats) => number | null;
  }[] = [
    { code: 'ace', predicate: (round) => round.kills === 5 },
    { code: 'four-kill', predicate: (round) => round.kills === 4 },
    { code: 'triple-kill', predicate: (round) => round.kills === 3 },
    {
      code: 'clutch-win',
      predicate: (round) => round.clutchOpponents !== null && round.clutchWon,
      getTick: (round) => round.clutchTick,
    },
    {
      code: 'utility-multi-kill',
      predicate: (round) =>
        round.weapons.reduce(
          (total, weapon) =>
            total +
            ([WeaponName.HEGrenade, WeaponName.Molotov, WeaponName.Incendiary].some((name) => name === weapon.weapon)
              ? weapon.kills
              : 0),
          0,
        ) >= 2,
    },
    {
      code: 'knife-kill',
      predicate: (round) => round.weapons.some((weapon) => weapon.weapon === WeaponName.Knife && weapon.kills > 0),
    },
    { code: 'damage-300', predicate: (round) => round.damage >= 300 },
    { code: 'damage-without-kill', predicate: (round) => round.damage >= 100 && round.kills === 0 },
    { code: 'double-trade', predicate: (round) => round.tradeKills >= 2 },
    { code: 'double-flash-assist', predicate: (round) => round.flashAssists >= 2 },
    {
      code: 'awp-triple',
      predicate: (round) => round.weapons.some((weapon) => weapon.weapon === WeaponName.AWP && weapon.kills >= 3),
    },
    {
      code: 'low-equipment-multi',
      predicate: (round) =>
        round.equipmentValue !== null && round.equipmentValue >= 0 && round.equipmentValue <= 2000 && round.kills >= 2,
    },
    { code: 'bomb-plant', predicate: (round) => round.bombPlants > 0 },
    { code: 'bomb-defuse', predicate: (round) => round.bombDefuses > 0 },
    {
      code: 'clutch-1v3',
      predicate: (round) => round.clutchOpponents !== null && round.clutchOpponents >= 3 && round.clutchWon,
      getTick: (round) => round.clutchTick,
    },
  ];
  return definitions.flatMap(({ code, predicate, getTick }) => {
    const matching = entries.filter(({ round }) => predicate(round));
    return matching.length === 0
      ? []
      : [{ code, count: matching.length, total: entries.length, evidence: evidence(matching, getTick) }];
  });
}

/** Derived from existing cached facts only; no raw-event query, cache revision or reparsing is required. */
export function buildPersonalAnalysis(
  selected: PersonalMatchStats[],
  originals: PersonalMatchStats[],
): PersonalAnalysis {
  const matches = selected.filter((match) => match.ratingEligible);
  const entries = matches.flatMap((match) =>
    match.rounds.toSorted((a, b) => a.roundNumber - b.roundNumber).map((round) => ({ match, round })),
  );
  const rounds = entries.map(({ round }) => round);
  const count = (predicate: Predicate) => rounds.filter(predicate).length;
  const sum = (value: (round: PersonalRoundStats) => number) =>
    rounds.reduce((total, round) => total + value(round), 0);
  const ofRounds = (predicate: Predicate) => rate(count(predicate), rounds.length);
  const halfLengths = new Map(originals.map((match) => [match.checksum, inferHalfLength(match)]));
  const adrs = matches
    .map((match) => calculatePersonalMetrics([match]).adr)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    tactics: buildTacticalAnalysis(matches),
    scope: {
      matchCount: matches.length,
      roundCount: rounds.length,
      excludedMatchCount: selected.length - matches.length,
      excludedRoundCount: selected.reduce((total, match) => total + match.rounds.length, 0) - rounds.length,
      knownResultMatchCount: matches.filter((match) => match.result !== 'unknown').length,
    },
    output: {
      nonUtilityDamage: average(
        sum((round) => Math.max(0, round.damage - round.utilityDamage)),
        rounds.length,
      ),
      killRounds: ofRounds((round) => round.kills > 0),
      killOrAssistRounds: ofRounds((round) => round.kills > 0 || round.assists > 0),
      multiKillRounds: ofRounds((round) => round.kills >= 2),
      damage100Rounds: ofRounds((round) => round.damage >= 100),
      zeroDamageRounds: ofRounds((round) => round.damage === 0),
    },
    survival: {
      survivedWinRounds: rate(
        count((round) => round.won && round.survived),
        count((round) => round.won),
      ),
      survivedLossRounds: rate(
        count((round) => !round.won && round.survived),
        count((round) => !round.won),
      ),
      untradedDeathRounds: rate(
        count((round) => round.deaths > 0 && round.tradedDeaths === 0),
        count((round) => round.deaths > 0),
      ),
      noImpactDeathRounds: rate(
        count((round) => round.deaths > 0 && round.kills === 0 && round.assists === 0 && round.damage === 0),
        count((round) => round.deaths > 0),
      ),
    },
    opening: {
      survivedOpeningKillRounds: rate(
        count((round) => round.openingKill && round.survived),
        count((round) => round.openingKill),
      ),
      winAfterOpeningDeath: rate(
        count((round) => round.openingDeath && round.won),
        count((round) => round.openingDeath),
      ),
      winWithoutOpeningEvent: rate(
        count((round) => !round.openingKill && !round.openingDeath && round.won),
        count((round) => !round.openingKill && !round.openingDeath),
      ),
    },
    utility: {
      usedUtilityRounds: ofRounds((round) => utilityCount(round) > 0),
      flashAssistRounds: ofRounds((round) => round.flashAssists > 0),
      teammateFlashRounds: ofRounds((round) => round.teammatesFlashed > 0),
      damagePerHeOrFire: average(
        sum((round) => round.utilityDamage),
        sum((round) => round.heThrown + round.fireThrown),
      ),
      blindSecondsPerFlash: average(
        sum((round) => round.enemyBlindSeconds),
        sum((round) => round.flashesThrown),
      ),
      enemiesPerFlash: average(
        sum((round) => round.enemiesFlashed),
        sum((round) => round.flashesThrown),
      ),
      teammatesPerFlash: average(
        sum((round) => round.teammatesFlashed),
        sum((round) => round.flashesThrown),
      ),
    },
    byRoundResult: groupMatches(matches, (_match, round) => (round.won ? 'win' : 'loss')),
    byMatchResult: groupMatches(matches, (match) => match.result),
    byPhase: groupMatches(matches, (match, round) => {
      const half = halfLengths.get(match.checksum);
      return half
        ? round.roundNumber <= half
          ? 'first-half'
          : round.roundNumber <= 2 * half
            ? 'second-half'
            : 'overtime'
        : 'unclassified';
    }),
    byMonth: groupMatches(matches, (match) =>
      Number.isFinite(Date.parse(match.date)) ? new Date(match.date).toISOString().slice(0, 7) : 'unknown',
    ),
    trend: buildTrend(matches),
    stability: {
      matchCount: adrs.length,
      adrMedian: quantile(adrs, 0.5),
      adrP25: quantile(adrs, 0.25),
      adrP75: quantile(adrs, 0.75),
    },
    streaks: buildStreaks(selected),
    findings: buildFindings(entries),
    achievements: buildAchievements(entries),
  };
}
