import type { DemoSource } from './counter-strike';
import type { PersonalStatsSide } from './personal-stats';
import type { ReviewClipRequest } from './review-clip';

type AiProvider = 'openai-compatible' | 'ollama';

export type AiConfiguration = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  secureStorageAvailable: boolean;
};

export type SaveAiConfiguration = Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model'> & {
  /** Input only. Omitted keeps the existing key; clearApiKey explicitly removes it. */
  apiKey?: string;
  clearApiKey?: boolean;
};

export type AiReportScope = {
  kind: 'personal' | 'match';
  steamId: string;
  /** Required only for a single-match report. Never transmitted to the provider. */
  checksum?: string;
  mapName?: string;
  side?: PersonalStatsSide;
  source?: DemoSource;
  locale: 'zh-CN' | 'en';
};

export type AiEvidence = {
  id: string;
  checksum: string;
  steamId: string;
  mapName: string;
  roundNumber: number;
  side: PersonalStatsSide;
  tick: number;
  eventTick: number | null;
  precision: 'event-context' | 'round-start';
};

type AiStatement = { text: string; evidenceIds: string[] };
type AiRecommendation = { title: string; action: string; uncertainty: string; evidenceIds: string[] };
export type AiScoreDimension = 'aim' | 'opening' | 'trading' | 'utility' | 'clutch';
type AiScore = {
  dimension: AiScoreDimension;
  /** Integer 0–100 subjective model assessment, never a rank/percentile. Missing data must stay null. */
  score: number | null;
  rationale: string;
  evidenceIds: string[];
};

export type AiReportContent = {
  summary: AiStatement;
  style: AiStatement & { label: string };
  observations: AiStatement[];
  recommendations: AiRecommendation[];
  scores: AiScore[];
  limitations: string[];
};

type AiReportPreview = {
  kind: AiReportScope['kind'];
  matchCount: number;
  roundCount: number;
  availableMatchCount: number;
  evidenceCount: number;
  maxMatches: number;
  /** Only aggregated numeric facts and sampled rounds are sent. No video or frames. */
  supportedInput: 'facts';
};

export type AiReport = {
  id: string;
  generatedAt: string;
  provider: AiProvider;
  model: string;
  promptVersion: number;
  contextHash: string;
  preview: AiReportPreview;
  content: AiReportContent;
  evidence: AiEvidence[];
  assessment: 'model-subjective';
  input: 'facts';
};

export type AiReportState = {
  preview: AiReportPreview;
  report: AiReport | null;
};

export type AiErrorCode =
  | 'invalid-configuration'
  | 'secure-storage-unavailable'
  | 'key-unavailable'
  | 'invalid-scope'
  | 'no-data'
  | 'request-failed'
  | 'request-timeout'
  | 'invalid-response'
  | 'response-truncated'
  | 'response-empty'
  | 'response-json-invalid'
  | 'response-schema-invalid'
  | 'response-evidence-invalid'
  | 'response-score-invalid'
  | 'storage-failed'
  | 'video-not-ready'
  | 'frame-extraction-failed'
  | 'preview-expired'
  | 'vision-unsupported'
  | 'busy';

/** IPC failures are allowlisted codes, never raw provider responses/keys/URLs. */
export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiErrorCode };

/** Server-produced context. Only payload is sent externally; the rest stays local. */
export type PreparedAiContext = {
  identityHash: string;
  contextHash: string;
  preview: AiReportPreview;
  evidence: AiEvidence[];
  payload: {
    kind: AiReportScope['kind'];
    locale: AiReportScope['locale'];
    sample: AiReportPreview;
    metrics: Record<string, number | null>;
    methodology: { rating: 'hltv-1.0-public'; rws: 'faceit-2025-public-local-v1'; tradeWindowSeconds: 5 };
    allowedScoreDimensions: AiScoreDimension[];
    bySide: { side: PersonalStatsSide; metrics: Record<string, number | null> }[];
    /** Bounded canonical weapon names; unknown names and overflow never expose arbitrary source text. */
    weapons: { weapon: string; kills: number; headshotKills: number; damage: number; shots: number }[];
    byClutchSize: {
      opponents: number;
      /** The last bucket groups 1v5 and larger situations. */
      atLeast: boolean;
      attempts: number;
      wins: number;
      winPercentage: number | null;
    }[];
    cohorts: {
      map: string;
      side: PersonalStatsSide;
      source: DemoSource;
      mode: string;
      build: number;
      rounds: number;
    }[];
    rounds: {
      id: string;
      match: string;
      round: number;
      side: PersonalStatsSide;
      won: boolean;
      kills: number;
      headshotKills: number;
      deaths: number;
      damage: number;
      nonUtilityDamage: number;
      openingKill: boolean;
      openingDeath: boolean;
      tradeKills: number;
      tradedDeaths: number;
      utilityThrown: number;
      utilityDamage: number;
      flashesThrown: number;
      smokesThrown: number;
      heThrown: number;
      fireThrown: number;
      flashAssists: number;
      enemiesFlashed: number;
      enemyBlindSeconds: number;
      teammatesFlashed: number;
      clutchOpponents: number | null;
      clutchWon: boolean;
    }[];
  };
};

/** One selected encounter, never an arbitrary renderer-supplied video path. itemIndex equals ReviewBatchItem.index. */
export type AiVideoSource =
  | { kind: 'clip'; request: ReviewClipRequest }
  | { kind: 'batch'; id: string; itemIndex: number };

/** Internal server media lookup. These filesystem paths and account identifiers never go to the AI provider. */
export type ResolvedVideoAiMedia = {
  revision: string;
  eventTick?: number;
  checksum: string;
  roundNumber: number;
  steamId: string;
  mapName: string;
  tickrate: number;
  segments: {
    perspective: 'player' | 'opponent';
    filePath: string;
    startTick: number;
    endTick: number;
    offsetSeconds: number;
    durationSeconds: number;
  }[];
};

export type VideoAiFrame = {
  id: string;
  perspective: 'player' | 'opponent';
  /** Position in the selected clip/item video, not in a batch compilation. */
  videoSeconds: number;
  demoTick: number;
  width: number;
  height: number;
  /** The exact resized JPEG submitted to the provider, also used for the consent preview. */
  dataUrl: string;
};

export type VideoAiFacts = {
  map: string;
  round: number;
  tickrate: number;
  side: PersonalStatsSide;
  won: boolean;
  kills: number;
  deaths: number;
  damage: number;
  openingKill: boolean;
  openingDeath: boolean;
  tradeKills: number;
  tradedDeaths: number;
  utilityThrown: number;
  utilityDamage: number;
};

type VideoAiPayload = {
  locale: 'zh-CN' | 'en';
  eventTick: number | null;
  facts: VideoAiFacts;
  frames: Omit<VideoAiFrame, 'dataUrl'>[];
  coverage: { perspective: 'player' | 'opponent'; startTick: number; endTick: number; frameCount: number }[];
  input: 'sampled-pov-frames-and-round-facts';
  audioIncluded: false;
};

export type PreparedVideoAiContext = {
  contextHash: string;
  source: AiVideoSource;
  frames: VideoAiFrame[];
  payload: VideoAiPayload;
};

export type VideoAiPoint = {
  frameIds: string[];
  observation: string;
  inference: string;
  /** Opponent information is hindsight; it must never be presented as player knowledge. */
  information: 'player-visible' | 'opponent-hindsight' | 'uncertain';
  alternative: string;
  uncertainty: string;
};

export type VideoAiContent = {
  visualInput: 'visible';
  summary: { text: string; frameIds: string[] };
  style: { text: string; frameIds: string[] };
  timeline: VideoAiPoint[];
  practice: { action: string; check: string; frameIds: string[] }[];
  limitations: string[];
};

export type VideoAiReport = {
  id: string;
  contextHash: string;
  generatedAt: string;
  provider: AiProvider;
  model: string;
  promptVersion: number;
  content: VideoAiContent;
  input: 'sampled-pov-frames-and-round-facts';
};

export type VideoAiReviewState = {
  /** Short-lived local preparation, bound to the exact frames and current provider/model configuration. */
  preparationId: string;
  expiresAt: string;
  frames: VideoAiFrame[];
  payload: VideoAiPayload;
  report: VideoAiReport | null;
};
