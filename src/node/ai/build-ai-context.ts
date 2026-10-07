import { createHash } from 'node:crypto';
import { TeamNumber, DemoSource, GameMode, WeaponName } from 'csdm/common/types/counter-strike';
import type { AiReportScope, PreparedAiContext, AiEvidence, AiScoreDimension } from 'csdm/common/types/ai';
import type {
  PersonalMatchStats,
  PersonalMetrics,
  PersonalRoundStats,
  PersonalStatsSummary,
} from 'csdm/common/types/personal-stats';
import { aggregatePersonalStats } from 'csdm/node/database/personal-stats/aggregate-personal-stats';
import { AiServiceError } from './ai-error';

export const AI_MAX_MATCHES = 10;

function numericMetrics(source: PersonalMetrics): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value === 'number')
      metrics[key] = value === null || Number.isFinite(value) ? value : null;
  }
  const nonUtilityDamage = Math.max(0, source.damage - source.utilityDamage);
  metrics.nonUtilityDamage = Number.isFinite(nonUtilityDamage) ? nonUtilityDamage : null;
  metrics.nonUtilityAdr =
    source.roundCount > 0 && metrics.nonUtilityDamage !== null ? metrics.nonUtilityDamage / source.roundCount : null;
  return metrics;
}

function advancedAnalysis(summary: PersonalStatsSummary): PreparedAiContext['payload']['analysis'] {
  const analysis = summary.analysis;
  const metrics: Record<string, number | null> = {
    matchCount: analysis.scope.matchCount,
    roundCount: analysis.scope.roundCount,
    excludedMatchCount: analysis.scope.excludedMatchCount,
    excludedRoundCount: analysis.scope.excludedRoundCount,
    adrMedian: analysis.stability.adrMedian,
    adrP25: analysis.stability.adrP25,
    adrP75: analysis.stability.adrP75,
    stabilityMatchCount: analysis.stability.matchCount,
    nonUtilityAdr: analysis.output.nonUtilityDamage.value,
    nonUtilityDamageTotal: analysis.output.nonUtilityDamage.total,
    nonUtilityDamageSamples: analysis.output.nonUtilityDamage.samples,
  };
  const rates = {
    killRounds: analysis.output.killRounds,
    killOrAssistRounds: analysis.output.killOrAssistRounds,
    multiKillRounds: analysis.output.multiKillRounds,
    damage100Rounds: analysis.output.damage100Rounds,
    zeroDamageRounds: analysis.output.zeroDamageRounds,
    survivedWinRounds: analysis.survival.survivedWinRounds,
    survivedLossRounds: analysis.survival.survivedLossRounds,
    untradedDeathRounds: analysis.survival.untradedDeathRounds,
    noImpactDeathRounds: analysis.survival.noImpactDeathRounds,
    survivedOpeningKillRounds: analysis.opening.survivedOpeningKillRounds,
    winAfterOpeningDeath: analysis.opening.winAfterOpeningDeath,
    winWithoutOpeningEvent: analysis.opening.winWithoutOpeningEvent,
    usedUtilityRounds: analysis.utility.usedUtilityRounds,
    flashAssistRounds: analysis.utility.flashAssistRounds,
    teammateFlashRounds: analysis.utility.teammateFlashRounds,
  };
  for (const [key, rate] of Object.entries(rates)) {
    metrics[`${key}Count`] = rate.count;
    metrics[`${key}Total`] = rate.total;
    metrics[`${key}Percentage`] = rate.percentage;
  }
  const averages = {
    damagePerHeOrFire: analysis.utility.damagePerHeOrFire,
    blindSecondsPerFlash: analysis.utility.blindSecondsPerFlash,
    enemiesPerFlash: analysis.utility.enemiesPerFlash,
    teammatesPerFlash: analysis.utility.teammatesPerFlash,
  };
  for (const [key, average] of Object.entries(averages)) {
    metrics[`${key}Total`] = average.total;
    metrics[`${key}Samples`] = average.samples;
    metrics[key] = average.value;
  }
  for (const [key, value] of Object.entries(metrics))
    if (value !== null && !Number.isFinite(value)) metrics[key] = null;
  const windowMetrics = (window: typeof analysis.trend.recent) =>
    window ? { matchCount: window.matchCount, metrics: numericMetrics(window.metrics) } : null;
  return {
    scope: 'standard-5v5',
    metrics,
    byPhase: analysis.byPhase
      .filter((group) => ['first-half', 'second-half', 'overtime', 'unclassified'].includes(group.key))
      .map((group) => ({ phase: group.key, metrics: numericMetrics(group.metrics) })),
    byRoundResult: analysis.byRoundResult
      .filter((group) => ['win', 'loss'].includes(group.key))
      .map((group) => ({ result: group.key, metrics: numericMetrics(group.metrics) })),
    trend: {
      comparable: analysis.trend.comparable,
      recent: windowMetrics(analysis.trend.recent),
      previous: windowMetrics(analysis.trend.previous),
    },
  };
}

function boundedWeapons(source: PersonalStatsSummary['weapons']): PreparedAiContext['payload']['weapons'] {
  const knownNames = new Set<string>(Object.values(WeaponName));
  const weapons = new Map<string, PreparedAiContext['payload']['weapons'][number]>();
  for (const item of source) {
    const weapon = knownNames.has(item.weapon) ? item.weapon : 'unknown';
    const total = weapons.get(weapon) ?? { weapon, kills: 0, headshotKills: 0, damage: 0, shots: 0 };
    for (const key of ['kills', 'headshotKills', 'damage', 'shots'] as const)
      total[key] += Number.isFinite(item[key]) ? Math.max(0, item[key]) : 0;
    weapons.set(weapon, total);
  }
  const sorted = [...weapons.values()].sort((a, b) => b.kills - a.kills || a.weapon.localeCompare(b.weapon));
  if (sorted.length <= 40) return sorted;
  const rest = sorted.slice(39).reduce(
    (total, item) => ({
      weapon: 'other',
      kills: total.kills + item.kills,
      headshotKills: total.headshotKills + item.headshotKills,
      damage: total.damage + item.damage,
      shots: total.shots + item.shots,
    }),
    { weapon: 'other', kills: 0, headshotKills: 0, damage: 0, shots: 0 },
  );
  return [...sorted.slice(0, 39), rest];
}

function boundedClutches(source: PersonalStatsSummary['byClutchSize']): PreparedAiContext['payload']['byClutchSize'] {
  const groups = new Map<number, PreparedAiContext['payload']['byClutchSize'][number]>();
  for (const item of source) {
    if (!Number.isInteger(item.opponents) || item.opponents < 1) continue;
    const opponents = Math.min(5, item.opponents);
    const total = groups.get(opponents) ?? {
      opponents,
      atLeast: opponents === 5,
      attempts: 0,
      wins: 0,
      winPercentage: null,
    };
    total.attempts += item.attempts;
    total.wins += item.wins;
    total.winPercentage = total.attempts > 0 ? (100 * total.wins) / total.attempts : null;
    groups.set(opponents, total);
  }
  return [...groups.values()].sort((a, b) => a.opponents - b.opponents);
}

export function validateAiScope(scope: AiReportScope) {
  if (
    !scope ||
    !['personal', 'match'].includes(scope.kind) ||
    typeof scope.steamId !== 'string' ||
    !/^\d{17}$/.test(scope.steamId) ||
    !['zh-CN', 'en'].includes(scope.locale) ||
    (scope.side !== undefined && scope.side !== TeamNumber.T && scope.side !== TeamNumber.CT) ||
    (scope.kind === 'match' && (typeof scope.checksum !== 'string' || !/^[a-f0-9]{1,64}$/.test(scope.checksum)))
  )
    throw new AiServiceError('invalid-scope');
}

function interesting(round: PersonalRoundStats) {
  return (
    Number(round.openingKill || round.openingDeath) * 4 +
    Number(round.clutchOpponents !== null) * 3 +
    Number(round.teammatesFlashed > 0) * 2 +
    Number(round.deaths > round.tradedDeaths)
  );
}

function sampledRounds(rounds: PersonalRoundStats[], limit: number) {
  const ranked = rounds
    .filter((round) => Number.isFinite(round.startTick) && round.startTick >= 0 && round.roundNumber > 0)
    .toSorted((a, b) => interesting(b) - interesting(a) || a.roundNumber - b.roundNumber);
  const chosen = new Set<PersonalRoundStats>();
  // Reserve examples for dimensions before filling by salience; opening events must not crowd out every clutch.
  const select = (predicate: (round: PersonalRoundStats) => boolean) => {
    if ([...chosen].some(predicate)) return;
    const item = ranked.find(predicate);
    if (item && chosen.size < limit) chosen.add(item);
  };
  select((round) => round.clutchOpponents !== null);
  select((round) => round.openingKill || round.openingDeath);
  select((round) => round.tradeKills > 0 || round.tradedDeaths > 0);
  if (![...chosen].some((round) => round.tradeKills > 0 || round.tradedDeaths > 0)) select((round) => round.deaths > 0);
  select(
    (round) =>
      round.utilityDamage > 0 || round.flashAssists > 0 || round.enemiesFlashed > 0 || round.teammatesFlashed > 0,
  );
  for (const round of ranked) {
    if (chosen.size >= limit) break;
    chosen.add(round);
  }
  return [...chosen].sort((a, b) => a.roundNumber - b.roundNumber);
}

export function buildAiContext(
  input: PersonalMatchStats[],
  scope: AiReportScope,
  availableMatchCount?: number,
): PreparedAiContext {
  validateAiScope(scope);
  const selected = [
    ...new Map(
      input.filter((match) => match.steamId === scope.steamId).map((match) => [match.checksum, match]),
    ).values(),
  ]
    .filter(
      (match) =>
        (scope.kind !== 'match' || match.checksum === scope.checksum) &&
        (!scope.mapName || match.mapName === scope.mapName) &&
        (!scope.source || match.source === scope.source),
    )
    .map((match) => ({
      ...match,
      rounds: match.rounds.filter((round) => scope.side === undefined || scope.side === round.side),
    }))
    .filter((match) => match.rounds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.checksum.localeCompare(b.checksum))
    .slice(0, scope.kind === 'match' ? 1 : AI_MAX_MATCHES);
  if (selected.length === 0) throw new AiServiceError('no-data');
  const selectedChecksums = new Set(selected.map((match) => match.checksum));
  // Keep full-match structure for phase classification; the aggregator applies the side filter itself.
  const summary = aggregatePersonalStats(
    input.filter((match) => selectedChecksums.has(match.checksum)),
    scope,
  );
  const metrics = numericMetrics(summary.metrics);
  const evidence: AiEvidence[] = [];
  const rounds: PreparedAiContext['payload']['rounds'] = [];
  for (const [matchIndex, match] of selected.entries()) {
    const chosen = sampledRounds(match.rounds, scope.kind === 'match' ? 24 : 4);
    for (const round of chosen) {
      const id = `r${String(evidence.length + 1).padStart(3, '0')}`;
      const candidate =
        round.openingDeathTick ?? round.openingKillTick ?? round.clutchTick ?? round.teamFlashTick ?? round.deathTick;
      const eventTick = Number.isFinite(candidate) && candidate !== null && candidate >= 0 ? candidate : null;
      const precise = eventTick !== null && Number.isFinite(match.tickrate) && match.tickrate > 0;
      evidence.push({
        id,
        checksum: match.checksum,
        steamId: scope.steamId,
        mapName: match.mapName,
        roundNumber: round.roundNumber,
        side: round.side,
        eventTick,
        tick: precise
          ? Math.max(Math.min(round.startTick, eventTick), Math.floor(eventTick - 8 * match.tickrate))
          : round.startTick,
        precision: precise ? 'event-context' : 'round-start',
      });
      rounds.push({
        id,
        match: `M${matchIndex + 1}`,
        round: round.roundNumber,
        side: round.side,
        won: round.won,
        kills: round.kills,
        headshotKills: round.headshotKills,
        deaths: round.deaths,
        damage: round.damage,
        nonUtilityDamage: Math.max(0, round.damage - round.utilityDamage),
        openingKill: round.openingKill,
        openingDeath: round.openingDeath,
        tradeKills: round.tradeKills,
        tradedDeaths: round.tradedDeaths,
        utilityThrown:
          round.flashesThrown + round.smokesThrown + round.heThrown + round.fireThrown + round.decoysThrown,
        utilityDamage: round.utilityDamage,
        flashesThrown: round.flashesThrown,
        smokesThrown: round.smokesThrown,
        heThrown: round.heThrown,
        fireThrown: round.fireThrown,
        flashAssists: round.flashAssists,
        enemiesFlashed: round.enemiesFlashed,
        enemyBlindSeconds: round.enemyBlindSeconds,
        teammatesFlashed: round.teammatesFlashed,
        clutchOpponents: round.clutchOpponents,
        clutchWon: round.clutchWon,
      });
    }
  }
  const allowedScoreDimensions: AiScoreDimension[] = [];
  if (evidence.length === 0) throw new AiServiceError('no-data');
  // Scores describe observed statistical performance, not calibrated mechanical ability.
  // Small samples need explicit uncertainty rather than blanket suppression. Zero utility usage is observable.
  if (summary.metrics.roundCount > 0) allowedScoreDimensions.push('aim');
  if (summary.metrics.openingAttempts > 0) allowedScoreDimensions.push('opening');
  if (summary.metrics.deaths > 0 || summary.metrics.tradeKills > 0) allowedScoreDimensions.push('trading');
  if (summary.metrics.roundCount > 0) allowedScoreDimensions.push('utility');
  if (summary.metrics.clutchAttempts > 0) allowedScoreDimensions.push('clutch');
  const preview = {
    kind: scope.kind,
    matchCount: selected.length,
    roundCount: summary.metrics.roundCount,
    availableMatchCount: availableMatchCount ?? selected.length,
    evidenceCount: evidence.length,
    maxMatches: scope.kind === 'match' ? 1 : AI_MAX_MATCHES,
    supportedInput: 'facts' as const,
  };
  const payload: PreparedAiContext['payload'] = {
    kind: scope.kind,
    locale: scope.locale,
    sample: preview,
    metrics,
    analysis: advancedAnalysis(summary),
    methodology: summary.methodology,
    allowedScoreDimensions,
    bySide: summary.bySide.map((group) => ({
      side: group.key === 't' ? TeamNumber.T : TeamNumber.CT,
      metrics: numericMetrics(group.metrics),
    })),
    weapons: boundedWeapons(summary.weapons),
    byClutchSize: boundedClutches(summary.byClutchSize),
    cohorts: selected.flatMap((match) =>
      [TeamNumber.T, TeamNumber.CT].flatMap((side) => {
        const count = match.rounds.filter((round) => round.side === side).length;
        return count
          ? [
              {
                map: /^de_[a-z0-9_]{1,60}$/.test(match.mapName) ? match.mapName : 'custom-map',
                side,
                source: Object.values(DemoSource).includes(match.source) ? match.source : DemoSource.Unknown,
                mode: Object.values(GameMode).includes(match.gameMode) ? match.gameMode : 'unknown',
                build: match.buildNumber,
                rounds: count,
              },
            ]
          : [];
      }),
    ),
    rounds,
  };
  return {
    identityHash: createHash('sha256').update(scope.steamId).digest('hex'),
    contextHash: createHash('sha256').update(JSON.stringify({ payload, evidence })).digest('hex'),
    preview,
    evidence,
    payload,
  };
}
