import { createHash } from 'node:crypto';
import { TeamNumber, DemoSource, GameMode } from 'csdm/common/types/counter-strike';
import type { AiReportScope, PreparedAiContext, AiEvidence, AiScoreDimension } from 'csdm/common/types/ai';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import { aggregatePersonalStats } from 'csdm/node/database/personal-stats/aggregate-personal-stats';
import { AiServiceError } from './ai-error';

export const AI_MAX_MATCHES = 10;

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
  const summary = aggregatePersonalStats(selected, scope);
  const metrics: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(summary.metrics)) {
    if (value === null || typeof value === 'number')
      metrics[key] = value === null || Number.isFinite(value) ? value : null;
  }
  const evidence: AiEvidence[] = [];
  const rounds: PreparedAiContext['payload']['rounds'] = [];
  for (const [matchIndex, match] of selected.entries()) {
    const chosen = match.rounds
      .filter((round) => Number.isFinite(round.startTick) && round.startTick >= 0 && round.roundNumber > 0)
      .toSorted((a, b) => interesting(b) - interesting(a) || a.roundNumber - b.roundNumber)
      .slice(0, scope.kind === 'match' ? 24 : 4)
      .sort((a, b) => a.roundNumber - b.roundNumber);
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
        deaths: round.deaths,
        damage: round.damage,
        openingKill: round.openingKill,
        openingDeath: round.openingDeath,
        tradeKills: round.tradeKills,
        tradedDeaths: round.tradedDeaths,
        utilityThrown:
          round.flashesThrown + round.smokesThrown + round.heThrown + round.fireThrown + round.decoysThrown,
        utilityDamage: round.utilityDamage,
        teammatesFlashed: round.teammatesFlashed,
        clutchOpponents: round.clutchOpponents,
        clutchWon: round.clutchWon,
      });
    }
  }
  const allowedScoreDimensions: AiScoreDimension[] = [];
  if (evidence.length === 0) throw new AiServiceError('no-data');
  const enough =
    scope.kind === 'match'
      ? summary.metrics.roundCount >= 12
      : selected.length >= 3 && summary.metrics.roundCount >= 30;
  if (enough && evidence.length > 0) {
    if (summary.metrics.openingAttempts >= 5) allowedScoreDimensions.push('opening');
    if (summary.metrics.deaths >= 10) allowedScoreDimensions.push('trading');
    if (
      summary.metrics.flashesThrown +
        summary.metrics.smokesThrown +
        summary.metrics.heThrown +
        summary.metrics.fireThrown >=
      10
    )
      allowedScoreDimensions.push('utility');
    allowedScoreDimensions.push('survival');
  }
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
    methodology: summary.methodology,
    allowedScoreDimensions,
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
