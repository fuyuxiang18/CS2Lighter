import type { DemoSource } from 'csdm/common/types/counter-strike';
import type { AnalysisStatus } from './analysis-status';
import type { ErrorCode } from '../error-code';

export type Analysis = {
  demoPath: string;
  demoChecksum: string;
  mapName: string;
  source: DemoSource;
  addedAt: string;
  status: AnalysisStatus;
  output: string;
  errorCode?: ErrorCode;
  analyzePositions?: boolean;
  // Automatic imports must not insert incomplete results from a corrupted recording.
  allowCorrupted?: boolean;
  // Database insertion succeeded, but its durable compact cache still needs a retry.
  cacheError?: string;
};
