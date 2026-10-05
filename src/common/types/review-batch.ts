import type { ReviewClipIssue, ReviewClipRequest, ReviewClipRequirements, ReviewClipStatus } from './review-clip';

export type ReviewBattleRequest = ReviewClipRequest & {
  /** Exact duel event tick when available; range-only evidence may omit it. */
  eventTick?: number;
  /** Only a hint: the server validates that this player fought the selected player. */
  opponentSteamId?: string;
};

export type ReviewBatchRequest = {
  clips: ReviewBattleRequest[];
  includeOpponent: boolean;
};

export type ReviewBatchSegment = {
  /** One-based, unique within the batch. */
  index: number;
  perspective: 'player' | 'opponent';
  steamId: string;
  playerName: string;
  startTick: number;
  endTick: number;
  deathTick?: number;
  truncatedAtDeath: boolean;
  status: ReviewClipStatus;
  /** Chapter start in this event's edited video; available after encoding. */
  offsetSeconds?: number;
  durationSeconds?: number;
};

export type ReviewBatchItem = {
  /** One-based, preserves selected event order. */
  index: number;
  request: ReviewBattleRequest;
  mapName: string;
  tickrate: number;
  eventTick?: number;
  opponentSteamId?: string;
  opponentName?: string;
  status: ReviewClipStatus;
  segments: ReviewBatchSegment[];
  /** A missing opponent is explicit; never substitute an unrelated player's camera. */
  opponentUnavailable: boolean;
  videoUrl?: string;
  durationSeconds?: number;
  /** Event start in the whole batch compilation. */
  offsetSeconds?: number;
  issue?: ReviewClipIssue;
  errorDetail?: string;
};

export type ReviewBatch = {
  schemaVersion: 1;
  id: string;
  status: ReviewClipStatus;
  createdAt: string;
  updatedAt: string;
  items: ReviewBatchItem[];
  includeOpponent: boolean;
  demoCount: number;
  completedDemos: number;
  totalSegments: number;
  completedSegments: number;
  currentDemo?: number;
  currentSegment?: number;
  /** Actual game starts, excluding fully cached requests. */
  launchCount: number;
  sourceMetadata: { format: 'cs2lighter-review-batch-v1'; includeOpponent: boolean; source: 'cs2-demo-render' };
  /** Compilation in user-selected event order, each event player POV then opponent POV. */
  videoUrl?: string;
  issue?: ReviewClipIssue;
  errorDetail?: string;
};

export type ReviewBatchInspection = { batch: ReviewBatch; requirements: ReviewClipRequirements };
