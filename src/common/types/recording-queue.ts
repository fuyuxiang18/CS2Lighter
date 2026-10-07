import type { ReviewBatch, ReviewBatchRequest, ReviewBattleRequest } from './review-batch';
import type { ReviewClipIssue } from './review-clip';

export type RecordingQueueItem = {
  id: string;
  request: ReviewBattleRequest;
  includeOpponent: boolean;
  mapName: string;
  playerName: string;
  opponentName?: string;
  demoName: string;
  eventKind: 'kill' | 'death' | 'damage' | 'range';
  opening: boolean;
  perspectives: ('player' | 'opponent')[];
  addedAt: string;
  status: 'pending' | 'active' | 'ready' | 'failed' | 'canceled';
  batchId?: string;
  batchItemIndex?: number;
  issue?: ReviewClipIssue;
};

export type RecordingQueue = {
  schemaVersion: 1;
  updatedAt: string;
  items: RecordingQueueItem[];
  running: boolean;
  pauseRequested: boolean;
  /** The active session only; ready media is always addressed through its batch manifest. */
  batch?: ReviewBatch;
};

export type AddToRecordingQueue = ReviewBatchRequest;
export type ControlRecordingQueue =
  | { action: 'start' | 'remove' | 'retry'; ids: string[] }
  | { action: 'pause' | 'cancel' };
