import type { ImportFileProgress, ImportFileStatus, ImportProgress } from 'csdm/common/types/import-progress';

const terminal = new Set<ImportFileStatus>(['completed', 'failed', 'skipped']);

/** Tracks file outcomes, including the database insertion after the analyzer has exited. */
export class ImportProgressTracker {
  private files = new Map<string, ImportFileProgress>();
  private discoveryDepth = 0;
  private batch = 0;

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
    const previous = this.files.get(filePath);
    if (!terminal.has(status) && (previous === undefined || terminal.has(previous.status))) {
      this.newBatchIfFinished();
    }
    this.files.set(filePath, { filePath, status, ...details });
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
    const counts = { waiting: 0, pending: 0, analyzing: 0, inserting: 0, completed: 0, failed: 0, skipped: 0 };
    for (const file of files) {
      counts[file.status] += 1;
    }
    const settled = counts.completed + counts.failed + counts.skipped;
    const active = counts.waiting + counts.pending + counts.analyzing + counts.inserting;
    const discovering = this.discoveryDepth > 0;
    const isBlocking = discovering || active > 0;
    return {
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
