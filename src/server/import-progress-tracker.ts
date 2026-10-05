import type { ImportFileProgress, ImportFileStatus, ImportProgress } from 'csdm/common/types/import-progress';
import type { DemoCacheDirectory } from 'csdm/common/types/demo-data-cache';
import { normalizeDemoPath } from 'csdm/common/normalize-demo-path';

const terminal = new Set<ImportFileStatus>(['completed', 'failed', 'skipped']);

/** Tracks file outcomes, including the database insertion after the analyzer has exited. */
export class ImportProgressTracker {
  private files = new Map<string, ImportFileProgress>();
  private discoveryDepth = 0;
  private batch = 0;
  private cacheDirectory: DemoCacheDirectory | null = null;
  private queuePaused = false;
  private effectiveConcurrency = 2;

  setQueueState(paused: boolean, concurrency: number) {
    if (this.queuePaused === paused && this.effectiveConcurrency === concurrency) return;
    this.queuePaused = paused;
    this.effectiveConcurrency = concurrency;
    if (paused) this.settleWaiting('paused');
    this.onChange();
  }

  constructor(private readonly onChange: () => void = () => {}) {}

  private hasActiveFiles() {
    return [...this.files.values()].some((file) => !terminal.has(file.status));
  }

  private newBatchIfFinished() {
    if (this.discoveryDepth === 0 && !this.hasActiveFiles()) {
      this.files.clear();
      this.batch += 1;
    }
  }

  beginDiscovery() {
    this.newBatchIfFinished();
    this.discoveryDepth += 1;
    this.onChange();
  }

  finishDiscovery() {
    this.discoveryDepth = Math.max(0, this.discoveryDepth - 1);
    this.onChange();
  }

  update(filePath: string, status: ImportFileStatus, details?: { reason?: string; message?: string }) {
    // A filesystem read started before Pause may finish afterward. Observing file stability is not queued work.
    if (this.queuePaused && status === 'waiting') {
      status = 'skipped';
      details = { reason: 'paused' };
    }
    const key = normalizeDemoPath(filePath);
    const previous = this.files.get(key);
    if (previous?.status === status && previous.reason === details?.reason && previous.message === details?.message)
      return;
    if (!terminal.has(status) && (previous === undefined || terminal.has(previous.status))) {
      this.newBatchIfFinished();
    }
    this.files.set(key, {
      filePath: previous?.filePath ?? filePath,
      index: this.files.get(key)?.index ?? this.files.size + 1,
      status,
      ...details,
    });
    this.onChange();
  }

  setCacheDirectory(directory: DemoCacheDirectory) {
    this.cacheDirectory = directory;
    this.onChange();
  }

  settleWaiting(reason: string) {
    let changed = false;
    for (const file of this.files.values()) {
      if (file.status === 'waiting') {
        file.status = 'skipped';
        file.reason = reason;
        changed = true;
      }
    }
    if (changed) {
      this.onChange();
    }
  }

  snapshot(): ImportProgress {
    const files = [...this.files.values()];
    const counts = {
      waiting: 0,
      pending: 0,
      analyzing: 0,
      inserting: 0,
      caching: 0,
      profiling: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const file of files) {
      counts[file.status] += 1;
    }
    const settled = counts.completed + counts.failed + counts.skipped;
    const active =
      counts.waiting + counts.pending + counts.analyzing + counts.inserting + counts.caching + counts.profiling;
    const discovering = this.discoveryDepth > 0;
    const isBlocking = discovering || active > 0;
    return {
      queuePaused: this.queuePaused,
      effectiveConcurrency: this.effectiveConcurrency,
      batchId: String(this.batch),
      phase: discovering
        ? 'discovering'
        : active > 0
          ? active === counts.waiting
            ? 'waiting'
            : 'processing'
          : files.length > 0
            ? 'complete'
            : 'idle',
      isBlocking,
      discovered: files.length,
      total: files.length,
      ...counts,
      settled,
      percent: files.length === 0 ? 0 : Math.min(isBlocking ? 99 : 100, Math.floor((settled / files.length) * 100)),
      cacheDirectory: this.cacheDirectory,
      currentFiles: files.filter((file) => !terminal.has(file.status)).slice(0, 10),
      failures: files
        .filter((file) => file.status === 'failed' || (file.status === 'skipped' && file.reason === 'unstable'))
        .map((file) => ({
          filePath: file.filePath,
          reason: file.reason ?? 'analysis',
          message: file.message ?? '',
        })),
    };
  }
}
