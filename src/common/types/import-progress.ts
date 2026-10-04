export type ImportFileStatus = 'waiting' | 'pending' | 'analyzing' | 'inserting' | 'completed' | 'failed' | 'skipped';

export type ImportFileProgress = {
  filePath: string;
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
  completed: number;
  failed: number;
  skipped: number;
  settled: number;
  percent: number;
  currentFiles: ImportFileProgress[];
  failures: { filePath: string; reason: string; message: string }[];
};
