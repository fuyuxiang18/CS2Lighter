import type { DemoCacheDirectory } from './demo-data-cache';

export type ImportFileStatus =
  | 'waiting'
  | 'pending'
  | 'analyzing'
  | 'inserting'
  | 'caching'
  | 'profiling'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ImportFileProgress = {
  filePath: string;
  index: number;
  status: ImportFileStatus;
  reason?: string;
  message?: string;
};

export type ImportProgress = {
  batchId: string;
  phase: 'idle' | 'discovering' | 'waiting' | 'processing' | 'complete';
  isBlocking: boolean;
  discovered: number;
  total: number;
  waiting: number;
  pending: number;
  analyzing: number;
  inserting: number;
  caching: number;
  profiling: number;
  completed: number;
  failed: number;
  skipped: number;
  settled: number;
  percent: number;
  cacheDirectory: DemoCacheDirectory | null;
  currentFiles: ImportFileProgress[];
  failures: { filePath: string; reason: string; message: string }[];
};
