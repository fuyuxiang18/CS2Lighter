import type { DemoSource } from './counter-strike';
import type { PersonalStatsSide } from './personal-stats';
import type { ReviewBattleRequest } from './review-batch';
import type { DeathRiskReport } from './death-risk';

export type DeathKind = 'enemy' | 'team' | 'self' | 'world' | 'unknown';
type DeathRuleCategory = 'mechanics' | 'exposure' | 'utility' | 'trading' | 'objectives' | 'resources' | 'context';
export type DeathSignal = 'shots' | 'positions' | 'visibility' | 'input' | 'weapon-state' | 'communication';
type DeathMeasureUnit = 'seconds' | 'units' | 'speed' | 'degrees' | 'count' | 'damage' | 'health' | 'armor';
export type DeathMeasure = { key: string; value: number; unit: DeathMeasureUnit };

/** Rule identifiers and measurements are deterministic; display copy lives in the translated UI. */
export type DeathFinding = {
  code: string;
  category: DeathRuleCategory;
  kind: 'observation' | 'review';
  evidenceTicks: number[];
  measures: DeathMeasure[];
};

export type DeathTimelineEvent = {
  id: string;
  tick: number;
  seconds: number;
  kind: 'death' | 'kill' | 'damage-taken' | 'damage-dealt' | 'shot' | 'blind' | 'utility' | 'plant' | 'defuse';
  actor?: string;
  target?: string;
  weapon?: string;
  value?: number;
};

export type DeathReviewRecord = {
  id: string;
  checksum: string;
  steamId: string;
  mapName: string;
  date: string;
  source: DemoSource;
  roundNumber: number;
  side: PersonalStatsSide | null;
  eventTick: number;
  startTick: number;
  endTick: number;
  tickrate: number;
  kind: DeathKind;
  killerSteamId: string | null;
  killerName: string | null;
  weapon: string;
  roundWon: boolean | null;
  distance: number | null;
  /** Diagnostic distance bands in game units, not weapon accuracy boundaries. */
  range: 'close' | 'medium' | 'long' | null;
  healthBeforeHit: number | null;
  teammatesAlive: number | null;
  enemiesAlive: number | null;
  findings: DeathFinding[];
  /** Read from the separate advanced-evidence cache, never inferred from legacy labels. */
  risk?: DeathRiskReport;
  evaluatedRules: string[];
  missingSignals: DeathSignal[];
  timeline: DeathTimelineEvent[];
  recordingRequest: ReviewBattleRequest | null;
};

export type DeathReviewScope = {
  steamId: string;
  checksum?: string;
  mapName?: string;
  source?: DemoSource;
  side?: PersonalStatsSide;
};
export type FetchDeathReviewPage = DeathReviewScope & {
  page?: number;
  findingCode?: string;
  kind?: DeathKind;
  filter?: 'all' | 'flagged' | 'needs-data';
};
export type DeathReviewProgress = {
  id: string;
  steamId: string;
  status: 'idle' | 'running' | 'completed' | 'canceled';
  total: number;
  completed: number;
  failed: number;
  currentChecksum?: string;
  currentDemoName?: string;
  errors: { checksum: string; reason: string }[];
};
export type DeathReviewPage = {
  items: DeathReviewRecord[];
  page: number;
  pageSize: number;
  total: number;
  totals: { deaths: number; flagged: number; needsData: number; analyzed?: number };
  coverage: { availableMatches: number; readyMatches: number; missingMatches: number; failedMatches: number };
  progress: DeathReviewProgress;
};
export type ControlDeathReview = DeathReviewScope & { action: 'cancel' | 'retry' };

export type DeathRuleDefinition = {
  code: string;
  category: DeathRuleCategory;
  support: 'events' | 'snapshots' | 'unavailable';
  requires: DeathSignal[];
};
