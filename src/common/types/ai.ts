import type { DemoSource } from './counter-strike';
import type { PersonalStatsSide } from './personal-stats';

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
export type AiScoreDimension = 'opening' | 'trading' | 'utility' | 'survival' | 'aim';
type AiScore = {
  dimension: AiScoreDimension;
  /** Integer 0–100 subjective model assessment, never a rank/percentile. Missing data must stay null. */
  score: number | null;
  rationale: string;
  evidenceIds: string[];
};

export type AiReportContent = {
  summary: AiStatement;
  style: AiStatement;
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
  | 'storage-failed'
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
      deaths: number;
      damage: number;
      openingKill: boolean;
      openingDeath: boolean;
      tradeKills: number;
      tradedDeaths: number;
      utilityThrown: number;
      utilityDamage: number;
      teammatesFlashed: number;
      clutchOpponents: number | null;
      clutchWon: boolean;
    }[];
  };
};
