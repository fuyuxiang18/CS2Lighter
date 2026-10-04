import type { DemoSource, GameMode } from './counter-strike';
import type { FetchPersonalStatsPayload, PersonalStatsSide } from './personal-stats';

export type FetchReviewInsightsPayload = FetchPersonalStatsPayload & { training?: ReviewTrainingScope };

export type ReviewEvidence = {
  checksum: string;
  steamId: string;
  mapName: string;
  date: string;
  source: DemoSource;
  side: PersonalStatsSide;
  roundNumber: number;
  tick: number;
  /** Playback starts up to eight seconds before the event, or at the round start when unavailable. */
  eventTick: number | null;
  precision: 'event-context' | 'round-start';
  won: boolean;
  kills: number;
  deaths: number;
  teammatesFlashed: number;
  clutchOpponents: number | null;
};

export type ReviewCardId =
  | 'opening-deaths'
  | 'opening-advantage-lost'
  | 'untraded-deaths'
  | 'team-flashes'
  | 'lost-clutches';

export type ReviewTrainingScope = {
  cardId: ReviewCardId;
  startedAt: string;
  mapName: string;
  side: PersonalStatsSide;
  source: DemoSource;
  gameMode: GameMode;
  buildNumber: number;
};

type ReviewTrainingPeriod = {
  occurrenceCount: number;
  denominator: number;
  percentage: number | null;
  matchCount: number;
  roundCount: number;
};
export type ReviewDenominator =
  | 'opening-duels'
  | 'opening-kill-rounds'
  | 'death-rounds'
  | 'flash-rounds'
  | 'clutch-rounds';

export type ReviewCard = {
  id: ReviewCardId;
  /** Each matching round is counted once, even with several flash/death events. */
  occurrenceCount: number;
  denominator: number;
  denominatorKind: ReviewDenominator;
  percentage: number;
  affectedMatches: number;
  sampleStatus: 'limited' | 'descriptive';
  /** Review order only, never an error severity or skill score. */
  evidence: ReviewEvidence[];
  evidenceTotal: number;
};

export type StyleDimensionId =
  | 'opening-participation'
  | 'trade-kill-share'
  | 'utility-round-share'
  | 'survival'
  | 'clutch-exposure';

export type StyleDimension = {
  id: StyleDimensionId;
  numerator: number;
  denominator: number;
  percentage: number | null;
  sampleStatus: 'limited' | 'descriptive';
};

export type ReviewTrendMetricId =
  | 'adr'
  | 'headshot-rate'
  | 'opening-participation'
  | 'opening-conversion'
  | 'traded-death-share'
  | 'utility-round-share'
  | 'survival';

type ReviewPeriod = {
  matchCount: number;
  roundCount: number;
  startDate: string | null;
  endDate: string | null;
};

export type ReviewTrendMetric = {
  id: ReviewTrendMetricId;
  unit: 'percent' | 'damage-per-round';
  earlier: { value: number | null; numerator: number; denominator: number };
  recent: { value: number | null; numerator: number; denominator: number };
  /** Percentage-point difference for percentage metrics; no improvement/worsening judgement. */
  delta: number | null;
  sampleStatus: 'ready' | 'insufficient';
  minimumDenominator: number;
};

export type ReviewComparison = {
  key: string;
  mapName: string;
  side: PersonalStatsSide;
  source: DemoSource;
  gameMode: GameMode;
  buildNumber: number;
  availableMatchCount: number;
  earlier: ReviewPeriod;
  recent: ReviewPeriod;
  sampleStatus: 'ready' | 'insufficient';
  metrics: ReviewTrendMetric[];
};

export type ReviewInsightsSummary = {
  steamId: string;
  matchCount: number;
  roundCount: number;
  style: StyleDimension[];
  cards: ReviewCard[];
  comparisons: ReviewComparison[];
  training: {
    scope: ReviewTrainingScope;
    earlier: ReviewTrainingPeriod;
    recent: ReviewTrainingPeriod;
    sampleStatus: 'ready' | 'insufficient';
  } | null;
  coverage: {
    availableMatches: number;
    analyzedMatches: number;
    skippedMatches: number;
    roundsWithReviewEvidence: number;
    evidencePrecision: 'event-context' | 'round-start' | 'mixed';
  };
  methodology: {
    version: 1;
    tradeWindowSeconds: 5;
    maxEvidencePerCard: 6;
    maxMatchesPerPeriod: 5;
    minimumMatchesPerPeriod: 2;
    minimumRoundsPerPeriod: 20;
  };
};
