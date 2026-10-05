export type ReviewClipRequest = {
  checksum: string;
  steamId: string;
  roundNumber: number;
  startTick: number;
  /** Omit to record up to twenty seconds, bounded by the round end. */
  endTick?: number;
};

export type ReviewClipStatus =
  | 'missing'
  | 'queued'
  | 'preparing'
  | 'recording'
  | 'encoding'
  | 'ready'
  | 'failed'
  | 'canceled';

export type ReviewClipIssue =
  | 'unsupported-platform'
  | 'cs2-missing'
  | 'hlae-missing'
  | 'ffmpeg-missing'
  | 'steam-not-running'
  | 'game-running'
  | 'game-files-conflict'
  | 'queue-busy'
  | 'demo-missing'
  | 'demo-changed'
  | 'invalid-request'
  | 'incompatible-path'
  | 'insufficient-space'
  | 'recording-failed'
  | 'output-missing'
  | 'interrupted'
  | 'update-maintenance';

export type ReviewClip = {
  id: string;
  request: Required<ReviewClipRequest>;
  status: ReviewClipStatus;
  /** Only provided after a real recording has completed and its MP4 exists. */
  videoUrl?: string;
  durationSeconds: number;
  updatedAt: string;
  issue?: ReviewClipIssue;
  errorDetail?: string;
  source: 'cs2-demo-render';
};

export type ReviewClipRequirements = {
  supportedPlatform: boolean;
  cs2Installed: boolean;
  hlaeInstalled: boolean;
  ffmpegInstalled: boolean;
  steamRunning: boolean;
  gameRunning: boolean;
  queueBusy: boolean;
  missingReasons: ReviewClipIssue[];
};

export type ReviewClipInspection = { clip: ReviewClip; requirements: ReviewClipRequirements };

export type ReviewPovState = {
  status: 'opening' | 'open' | 'closed' | 'failed';
  request: ReviewClipRequest;
  issue?: ReviewClipIssue;
  errorDetail?: string;
};
