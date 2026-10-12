import type {
  DeathEvidenceKey,
  DeathEvidenceReport,
  DeathEvidenceState,
  InspectDeathEvidence,
} from 'csdm/common/types/death-evidence';
import { validateDeathEvidenceKey } from './death-evidence-cache';

type Progress = Pick<DeathEvidenceState, 'phase' | 'completedTicks' | 'totalTicks'>;
type Context = { revision: string };
type Dependencies<T extends Context> = {
  prepare: (key: DeathEvidenceKey) => Promise<T>;
  read: (key: DeathEvidenceKey, context: T) => Promise<DeathEvidenceReport | undefined>;
  build: (
    key: DeathEvidenceKey,
    context: T,
    signal: AbortSignal,
    progress: (progress: Progress) => void,
  ) => Promise<DeathEvidenceReport>;
  current: (key: DeathEvidenceKey, context: T) => Promise<boolean>;
  write: (context: T, report: DeathEvidenceReport, signal: AbortSignal) => Promise<void>;
  canStart: () => boolean;
  changed: (state: DeathEvidenceState) => void;
};
type Job<T> = { state: DeathEvidenceState; context: T; controller: AbortController };

function id(key: DeathEvidenceKey) {
  return JSON.stringify([key.checksum, key.steamId, key.deathId]);
}
function initial(key: DeathEvidenceKey): DeathEvidenceState {
  return {
    checksum: key.checksum,
    steamId: key.steamId,
    deathId: key.deathId,
    status: 'idle',
    phase: 'prepare',
    completedTicks: 0,
    totalTicks: 0,
    report: null,
    error: null,
  };
}

/** One cancelable worker, separate from import/base statistics. Opening a cached death never decodes it again. */
export class DeathEvidenceService<T extends Context> {
  private jobs = new Map<string, Job<T>>();
  private queue: Job<T>[] = [];
  private draining = false;

  constructor(private dependencies: Dependencies<T>) {}

  isBusy() {
    return this.draining || this.queue.some((job) => !job.controller.signal.aborted);
  }

  private emit(job: Job<T>) {
    if (this.jobs.get(id(job.state)) === job) this.dependencies.changed(structuredClone(job.state));
  }

  private prune() {
    for (const [key, job] of this.jobs) {
      if (this.jobs.size < 64) break;
      if (job.state.status !== 'queued' && job.state.status !== 'running') this.jobs.delete(key);
    }
  }

  async inspect(request: InspectDeathEvidence): Promise<DeathEvidenceState> {
    validateDeathEvidenceKey(request);
    if (!['read', 'analyze', 'refresh', 'cancel'].includes(request.action))
      throw new Error('Invalid death evidence action');
    const key = id(request);
    let existing = this.jobs.get(key);
    if (request.action === 'cancel') {
      if (!existing || !['queued', 'running'].includes(existing.state.status))
        return structuredClone(existing?.state ?? initial(request));
      existing.controller.abort();
      existing.state.status = 'canceled';
      this.emit(existing);
      return structuredClone(existing.state);
    }
    const context = await this.dependencies.prepare(request);
    const cached = await this.dependencies.read(request, context);
    // Inspect may overlap another request or a worker completion while reading the cache.
    existing = this.jobs.get(key);
    if (existing && existing.context.revision !== context.revision) {
      existing.controller.abort();
      this.jobs.delete(key);
      existing = undefined;
    }
    if (existing && ['queued', 'running'].includes(existing.state.status)) return structuredClone(existing.state);
    if (cached && request.action !== 'refresh') {
      return {
        ...initial(request),
        status: 'completed',
        phase: 'evaluate',
        completedTicks: cached.coverage.decodedTicks,
        totalTicks: cached.coverage.requestedTicks,
        report: cached,
      };
    }
    if (existing?.state.status === 'completed' && request.action !== 'refresh') return structuredClone(existing.state);
    if (request.action === 'read') return structuredClone(existing?.state ?? initial(request));
    if (!this.dependencies.canStart()) throw new Error('Application update is in progress');
    this.prune();
    if (this.queue.filter((job) => !job.controller.signal.aborted).length >= 32)
      throw new Error('Death evidence queue is full');
    const job: Job<T> = {
      state: { ...initial(request), status: 'queued', report: cached ?? existing?.state.report ?? null },
      context,
      controller: new AbortController(),
    };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.emit(job);
    void this.drain();
    return structuredClone(job.state);
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      let job: Job<T> | undefined;
      while ((job = this.queue.shift())) {
        const currentJob = job;
        const signal = job.controller.signal;
        if (signal.aborted) continue;
        if (!this.dependencies.canStart()) {
          job.controller.abort();
          job.state.status = 'canceled';
          this.emit(job);
          continue;
        }
        job.state.status = 'running';
        this.emit(job);
        try {
          const report = await this.dependencies.build(job.state, job.context, signal, (progress) => {
            if (signal.aborted) return;
            currentJob.state.phase = progress.phase;
            currentJob.state.totalTicks = Math.max(0, progress.totalTicks);
            currentJob.state.completedTicks = Math.max(0, Math.min(progress.completedTicks, progress.totalTicks));
            this.emit(currentJob);
          });
          signal.throwIfAborted();
          if (!(await this.dependencies.current(job.state, job.context)))
            throw new Error('Demo or map changed during evidence analysis; retry this death');
          signal.throwIfAborted();
          await this.dependencies.write(job.context, report, signal);
          signal.throwIfAborted();
          job.state.status = 'completed';
          job.state.phase = 'evaluate';
          job.state.completedTicks = report.coverage.decodedTicks;
          job.state.totalTicks = report.coverage.requestedTicks;
          job.state.report = report;
        } catch (error) {
          job.state.status = signal.aborted ? 'canceled' : 'error';
          job.state.error = signal.aborted
            ? null
            : (error instanceof Error ? error.message : String(error)).slice(0, 500);
        }
        this.emit(job);
      }
    } finally {
      this.draining = false;
    }
  }
}
