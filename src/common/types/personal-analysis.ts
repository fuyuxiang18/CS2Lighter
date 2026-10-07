import type { PersonalMetrics, PersonalStatsGroup, PersonalStatsSide } from './personal-stats';

export type PersonalRate = { count: number; total: number; percentage: number | null };
export type PersonalAverage = { total: number; samples: number; value: number | null };

export type PersonalAnalysisEvidence = {
  checksum: string;
  mapName: string;
  roundNumber: number;
  tick: number;
  side: PersonalStatsSide;
};

export type PersonalFindingCode =
  | 'opening-conversion'
  | 'untraded-deaths'
  | 'team-flashes'
  | 'zero-utility'
  | 'multi-kill-rounds'
  | 'clutch-wins'
  | 'flash-assists';

export type PersonalAchievementCode =
  | 'ace'
  | 'four-kill'
  | 'triple-kill'
  | 'clutch-win'
  | 'utility-multi-kill'
  | 'knife-kill'
  | 'damage-300'
  | 'damage-without-kill'
  | 'double-trade'
  | 'double-flash-assist'
  | 'awp-triple'
  | 'low-equipment-multi'
  | 'bomb-plant'
  | 'bomb-defuse'
  | 'clutch-1v3';

export type PersonalAnalysis = {
  /** Advanced analysis uses standard 5v5 facts only; the main summary still contains every selected match. */
  scope: {
    matchCount: number;
    roundCount: number;
    excludedMatchCount: number;
    excludedRoundCount: number;
    knownResultMatchCount: number;
  };
  output: {
    nonUtilityDamage: PersonalAverage;
    killRounds: PersonalRate;
    killOrAssistRounds: PersonalRate;
    multiKillRounds: PersonalRate;
    damage100Rounds: PersonalRate;
    zeroDamageRounds: PersonalRate;
  };
  survival: {
    survivedWinRounds: PersonalRate;
    survivedLossRounds: PersonalRate;
    /** Denominator is rounds with at least one death, not inferred trade opportunities. */
    untradedDeathRounds: PersonalRate;
    noImpactDeathRounds: PersonalRate;
  };
  opening: {
    survivedOpeningKillRounds: PersonalRate;
    winAfterOpeningDeath: PersonalRate;
    winWithoutOpeningEvent: PersonalRate;
  };
  utility: {
    usedUtilityRounds: PersonalRate;
    flashAssistRounds: PersonalRate;
    teammateFlashRounds: PersonalRate;
    damagePerHeOrFire: PersonalAverage;
    blindSecondsPerFlash: PersonalAverage;
    enemiesPerFlash: PersonalAverage;
    teammatesPerFlash: PersonalAverage;
  };
  /** Every group's match win rate uses the original complete-match result, not its selected round result. */
  byRoundResult: PersonalStatsGroup[];
  byMatchResult: PersonalStatsGroup[];
  /** first-half / second-half / overtime / unclassified; inferred only from verified 12/15-round side changes. */
  byPhase: PersonalStatsGroup[];
  /** ISO UTC YYYY-MM, never the current computer's local timezone. */
  byMonth: PersonalStatsGroup[];
  trend: {
    /** Equal-sized, disjoint windows of up to five matches; null when fewer than four dated matches. */
    recent: { matchCount: number; metrics: PersonalMetrics; from: string; to: string } | null;
    previous: { matchCount: number; metrics: PersonalMetrics; from: string; to: string } | null;
    /** Same map, source, mode and build in both windows. Descriptive deltas are not causal conclusions. */
    comparable: boolean;
  };
  stability: { matchCount: number; adrMedian: number | null; adrP25: number | null; adrP75: number | null };
  streaks: {
    longestMatchWins: number;
    longestMatchLosses: number;
    currentMatchResult: 'win' | 'loss' | null;
    currentMatchCount: number;
    longestRoundWins: number;
    longestRoundLosses: number;
  };
  findings: {
    code: PersonalFindingCode;
    kind: 'focus' | 'strength';
    count: number;
    total: number;
    evidence: PersonalAnalysisEvidence[];
  }[];
  achievements: {
    code: PersonalAchievementCode;
    /** Count of matching rounds; each round can receive more than one different event label. */
    count: number;
    total: number;
    evidence: PersonalAnalysisEvidence[];
  }[];
};
