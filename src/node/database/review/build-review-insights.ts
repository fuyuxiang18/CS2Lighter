import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import type {
  FetchReviewInsightsPayload,
  ReviewCard,
  ReviewCardId,
  ReviewComparison,
  ReviewDenominator,
  ReviewEvidence,
  ReviewInsightsSummary,
  ReviewTrainingScope,
  ReviewTrendMetric,
  ReviewTrendMetricId,
  StyleDimension,
  StyleDimensionId,
} from 'csdm/common/types/review-insights';

type RoundContext = { match: PersonalMatchStats; round: PersonalRoundStats };
type TrendSample = ReviewTrendMetric['recent'];

const methodology: ReviewInsightsSummary['methodology'] = {
  version: 1,
  tradeWindowSeconds: 5,
  maxEvidencePerCard: 6,
  maxMatchesPerPeriod: 5,
  minimumMatchesPerPeriod: 2,
  minimumRoundsPerPeriod: 20,
};

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator * 100) / denominator : null;
}

function utilityCount(round: PersonalRoundStats) {
  return round.flashesThrown + round.smokesThrown + round.heThrown + round.fireThrown + round.decoysThrown;
}

function canReplay(round: PersonalRoundStats) {
  return (
    Number.isInteger(round.roundNumber) &&
    round.roundNumber > 0 &&
    Number.isFinite(round.startTick) &&
    round.startTick >= 0
  );
}

function evidence({ match, round }: RoundContext, id: ReviewCardId): ReviewEvidence {
  const recordedTick =
    id === 'opening-deaths'
      ? round.openingDeathTick
      : id === 'opening-advantage-lost'
        ? round.openingKillTick
        : id === 'team-flashes'
          ? round.teamFlashTick
          : id === 'lost-clutches'
            ? round.clutchTick
            : round.deaths === 1
              ? round.deathTick
              : null;
  // A respawn round can contain both traded and untraded deaths. Its first death alone cannot locate the latter.
  const eventTick = recordedTick !== null && Number.isFinite(recordedTick) && recordedTick >= 0 ? recordedTick : null;
  const hasContext = eventTick !== null && Number.isFinite(match.tickrate) && match.tickrate > 0;
  return {
    checksum: match.checksum,
    steamId: match.steamId,
    mapName: match.mapName,
    date: match.date,
    source: match.source,
    side: round.side,
    roundNumber: round.roundNumber,
    tick: hasContext
      ? Math.max(Math.min(round.startTick, eventTick), Math.floor(eventTick - 8 * match.tickrate))
      : round.startTick,
    eventTick,
    precision: hasContext ? 'event-context' : 'round-start',
    won: round.won,
    kills: round.kills,
    deaths: round.deaths,
    teammatesFlashed: round.teammatesFlashed,
    clutchOpponents: round.clutchOpponents,
  };
}

function styleDimensions(contexts: RoundContext[], matchCount: number): StyleDimension[] {
  const count = (predicate: (round: PersonalRoundStats) => boolean) =>
    contexts.filter(({ round }) => predicate(round)).length;
  const sum = (value: (round: PersonalRoundStats) => number) =>
    contexts.reduce((total, { round }) => total + value(round), 0);
  const dimension = (id: StyleDimensionId, numerator: number, denominator: number): StyleDimension => ({
    id,
    numerator,
    denominator,
    percentage: percentage(numerator, denominator),
    sampleStatus: matchCount >= 3 && denominator >= 30 ? 'descriptive' : 'limited',
  });
  return [
    dimension(
      'opening-participation',
      count((round) => round.openingKill || round.openingDeath),
      contexts.length,
    ),
    dimension(
      'trade-kill-share',
      sum((round) => round.tradeKills),
      sum((round) => round.kills),
    ),
    dimension(
      'utility-round-share',
      count((round) => utilityCount(round) > 0),
      contexts.length,
    ),
    dimension(
      'survival',
      count((round) => round.survived),
      contexts.length,
    ),
    dimension(
      'clutch-exposure',
      count((round) => round.clutchOpponents !== null),
      contexts.length,
    ),
  ];
}

const cardDefinitions: {
  id: ReviewCardId;
  denominatorKind: ReviewDenominator;
  eligible: (round: PersonalRoundStats) => boolean;
  matches: (round: PersonalRoundStats) => boolean;
}[] = [
  {
    id: 'opening-advantage-lost',
    denominatorKind: 'opening-kill-rounds',
    eligible: (round) => round.openingKill,
    matches: (round) => round.openingKill && !round.won,
  },
  {
    id: 'opening-deaths',
    denominatorKind: 'opening-duels',
    eligible: (round) => round.openingKill || round.openingDeath,
    matches: (round) => round.openingDeath,
  },
  {
    id: 'untraded-deaths',
    denominatorKind: 'death-rounds',
    eligible: (round) => round.deaths > 0,
    matches: (round) => round.deaths > round.tradedDeaths,
  },
  {
    id: 'team-flashes',
    denominatorKind: 'flash-rounds',
    eligible: (round) => round.flashesThrown > 0 || round.teammatesFlashed > 0,
    matches: (round) => round.teammatesFlashed > 0,
  },
  {
    id: 'lost-clutches',
    denominatorKind: 'clutch-rounds',
    eligible: (round) => round.clutchOpponents !== null,
    matches: (round) => round.clutchOpponents !== null && !round.clutchWon,
  },
];

function reviewCards(contexts: RoundContext[], matchCount: number): ReviewCard[] {
  const cards: ReviewCard[] = [];
  // Fixed topic order is a review sequence, not a ranking of how badly the user played.
  for (const definition of cardDefinitions) {
    const eligible = contexts.filter(({ round }) => definition.eligible(round));
    const occurrences = eligible.filter(({ round }) => definition.matches(round));
    if (occurrences.length === 0) continue;
    const replayable = occurrences.filter(({ round }) => canReplay(round));
    cards.push({
      id: definition.id,
      occurrenceCount: occurrences.length,
      denominator: eligible.length,
      denominatorKind: definition.denominatorKind,
      percentage: percentage(occurrences.length, eligible.length)!,
      affectedMatches: new Set(occurrences.map(({ match }) => match.checksum)).size,
      sampleStatus: matchCount >= 3 && eligible.length >= 10 ? 'descriptive' : 'limited',
      evidence: replayable.slice(0, methodology.maxEvidencePerCard).map((context) => evidence(context, definition.id)),
      evidenceTotal: replayable.length,
    });
  }
  return cards;
}

const trendDefinitions: {
  id: ReviewTrendMetricId;
  unit: ReviewTrendMetric['unit'];
  minimumDenominator: number;
  values: (round: PersonalRoundStats) => [numerator: number, denominator: number];
}[] = [
  { id: 'adr', unit: 'damage-per-round', minimumDenominator: 20, values: (round) => [round.damage, 1] },
  {
    id: 'headshot-rate',
    unit: 'percent',
    minimumDenominator: 10,
    values: (round) => [round.headshotKills, round.kills],
  },
  {
    id: 'opening-participation',
    unit: 'percent',
    minimumDenominator: 20,
    values: (round) => [Number(round.openingKill || round.openingDeath), 1],
  },
  {
    id: 'opening-conversion',
    unit: 'percent',
    minimumDenominator: 5,
    values: (round) => [Number(round.openingKill && round.won), Number(round.openingKill)],
  },
  {
    id: 'traded-death-share',
    unit: 'percent',
    minimumDenominator: 10,
    values: (round) => [round.tradedDeaths, round.deaths],
  },
  {
    id: 'utility-round-share',
    unit: 'percent',
    minimumDenominator: 20,
    values: (round) => [Number(utilityCount(round) > 0), 1],
  },
  { id: 'survival', unit: 'percent', minimumDenominator: 20, values: (round) => [Number(round.survived), 1] },
];

function period(matches: PersonalMatchStats[]): ReviewComparison['recent'] {
  return {
    matchCount: matches.length,
    roundCount: matches.reduce((sum, match) => sum + match.rounds.length, 0),
    startDate: matches[0]?.date ?? null,
    endDate: matches.at(-1)?.date ?? null,
  };
}

function comparison(key: string, matches: PersonalMatchStats[]): ReviewComparison {
  const first = matches[0];
  const chronological = matches.toSorted(
    (a, b) => a.date.localeCompare(b.date) || a.checksum.localeCompare(b.checksum),
  );
  const latest = chronological.slice(-methodology.maxMatchesPerPeriod * 2);
  const split = Math.floor(latest.length / 2);
  const earlierMatches = latest.slice(0, split);
  const recentMatches = latest.slice(split);
  const earlier = period(earlierMatches);
  const recent = period(recentMatches);
  const ready = [earlier, recent].every(
    (window) =>
      window.matchCount >= methodology.minimumMatchesPerPeriod &&
      window.roundCount >= methodology.minimumRoundsPerPeriod,
  );
  const metrics = trendDefinitions.map((definition): ReviewTrendMetric => {
    const sample = (entries: PersonalMatchStats[]): TrendSample => {
      let numerator = 0;
      let denominator = 0;
      for (const match of entries)
        for (const round of match.rounds) {
          const [n, d] = definition.values(round);
          numerator += n;
          denominator += d;
        }
      return {
        numerator,
        denominator,
        value: denominator > 0 ? (numerator / denominator) * (definition.unit === 'percent' ? 100 : 1) : null,
      };
    };
    const previous = sample(earlierMatches);
    const current = sample(recentMatches);
    const sufficient =
      ready &&
      previous.denominator >= definition.minimumDenominator &&
      current.denominator >= definition.minimumDenominator;
    return {
      id: definition.id,
      unit: definition.unit,
      earlier: previous,
      recent: current,
      delta: sufficient && current.value !== null && previous.value !== null ? current.value - previous.value : null,
      sampleStatus: sufficient ? 'ready' : 'insufficient',
      minimumDenominator: definition.minimumDenominator,
    };
  });
  return {
    key,
    mapName: first.mapName,
    side: first.rounds[0].side,
    source: first.source,
    gameMode: first.gameMode,
    buildNumber: first.buildNumber,
    availableMatchCount: matches.length,
    earlier,
    recent,
    sampleStatus: ready ? 'ready' : 'insufficient',
    metrics,
  };
}

function trainingComparison(
  library: PersonalMatchStats[],
  scope: ReviewTrainingScope | undefined,
): ReviewInsightsSummary['training'] {
  if (!scope) return null;
  const definition = cardDefinitions.find((card) => card.id === scope.cardId);
  const startedAt = Date.parse(scope.startedAt);
  if (!definition || !Number.isFinite(startedAt) || !/^\d{4}-\d{2}-\d{2}T/.test(scope.startedAt))
    throw new Error('Invalid review training scope');
  if (
    !scope.mapName ||
    !Number.isFinite(scope.buildNumber) ||
    (scope.side !== TeamNumber.T && scope.side !== TeamNumber.CT)
  )
    throw new Error('Invalid review training cohort');
  const matches = library
    .filter(
      (match) =>
        match.mapName === scope.mapName &&
        match.source === scope.source &&
        match.gameMode === scope.gameMode &&
        match.buildNumber === scope.buildNumber &&
        Number.isFinite(Date.parse(match.date)),
    )
    .map((match) => ({ ...match, rounds: match.rounds.filter((round) => round.side === scope.side) }))
    .filter((match) => match.rounds.length > 0)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.checksum.localeCompare(b.checksum));
  const summarize = (entries: PersonalMatchStats[]) => {
    const rounds = entries.flatMap((match) => match.rounds);
    const eligible = rounds.filter(definition.eligible);
    const occurrenceCount = eligible.filter(definition.matches).length;
    return {
      occurrenceCount,
      denominator: eligible.length,
      percentage: percentage(occurrenceCount, eligible.length),
      matchCount: entries.length,
      roundCount: rounds.length,
    };
  };
  const earlier = summarize(matches.filter((match) => Date.parse(match.date) <= startedAt).slice(-5));
  const recent = summarize(matches.filter((match) => Date.parse(match.date) > startedAt).slice(-5));
  const ready = [earlier, recent].every(
    (sample) => sample.matchCount >= 2 && sample.roundCount >= 20 && sample.denominator >= 5,
  );
  return { scope, earlier, recent, sampleStatus: ready ? 'ready' : 'insufficient' };
}

export function buildReviewInsights(
  input: PersonalMatchStats[],
  payload: FetchReviewInsightsPayload,
  availableMatches?: number,
): ReviewInsightsSummary {
  const identityLibrary = [
    ...new Map(
      input.filter((match) => match.steamId === payload.steamId).map((match) => [match.checksum, match]),
    ).values(),
  ];
  const library = identityLibrary.filter(
    (match) =>
      (!payload.mapName || payload.mapName === match.mapName) && (!payload.source || payload.source === match.source),
  );
  const analyzedMatches = library.filter((match) => match.rounds.length > 0).length;
  const selected = library
    .map((match) => ({
      ...match,
      rounds: match.rounds
        .filter(
          (round) =>
            (round.side === TeamNumber.T || round.side === TeamNumber.CT) &&
            (payload.side === undefined || payload.side === round.side),
        )
        .toSorted((a, b) => a.roundNumber - b.roundNumber),
    }))
    .filter((match) => match.rounds.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.checksum.localeCompare(b.checksum));
  const contexts = selected.flatMap((match) => match.rounds.map((round) => ({ match, round })));
  const groups = new Map<string, PersonalMatchStats[]>();
  for (const match of selected) {
    for (const side of [TeamNumber.T, TeamNumber.CT]) {
      const rounds = match.rounds.filter((round) => round.side === side);
      if (rounds.length === 0) continue;
      const key = JSON.stringify([match.mapName, side, match.source, match.gameMode, match.buildNumber]);
      const entries = groups.get(key) ?? [];
      entries.push({ ...match, rounds });
      groups.set(key, entries);
    }
  }
  const comparisons = Array.from(groups, ([key, matches]) => comparison(key, matches)).sort(
    (a, b) => (b.recent.endDate ?? '').localeCompare(a.recent.endDate ?? '') || a.key.localeCompare(b.key),
  );
  const available = availableMatches ?? library.length;
  const cards = reviewCards(contexts, selected.length);
  const evidencePrecisions = new Set(cards.flatMap((card) => card.evidence.map((item) => item.precision)));
  return {
    steamId: payload.steamId,
    matchCount: selected.length,
    roundCount: contexts.length,
    style: styleDimensions(contexts, selected.length),
    cards,
    comparisons,
    training: trainingComparison(identityLibrary, payload.training),
    coverage: {
      availableMatches: available,
      analyzedMatches,
      skippedMatches: Math.max(0, available - analyzedMatches),
      roundsWithReviewEvidence: contexts.filter(({ round }) => canReplay(round)).length,
      evidencePrecision:
        evidencePrecisions.size > 1
          ? 'mixed'
          : evidencePrecisions.has('event-context')
            ? 'event-context'
            : 'round-start',
    },
    methodology: { ...methodology },
  };
}
