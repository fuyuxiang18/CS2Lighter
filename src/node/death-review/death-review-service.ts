import { createHash } from 'node:crypto';
import { DemoSource, TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  ControlDeathReview,
  DeathReviewPage,
  DeathReviewProgress,
  DeathReviewRecord,
  DeathReviewScope,
  FetchDeathReviewPage,
} from 'csdm/common/types/death-review';
import { deathMatchRevision, type DeathMatchDescriptor } from './death-review-cache';
import { getDemoCacheGeneration } from 'csdm/node/demo-cache/cache-generation';

type Dependencies = {
  listMatches: (scope: DeathReviewScope) => Promise<DeathMatchDescriptor[]>;
  read: (match: DeathMatchDescriptor) => Promise<DeathReviewRecord[] | undefined>;
  build: (match: DeathMatchDescriptor, signal: AbortSignal) => Promise<DeathReviewRecord[]>;
  isCurrent: (match: DeathMatchDescriptor) => Promise<boolean>;
  write: (
    match: DeathMatchDescriptor,
    records: DeathReviewRecord[],
    signal: AbortSignal,
    generation: number,
  ) => Promise<void>;
  canStart: () => boolean;
  changed: (progress: DeathReviewProgress) => void;
};
type Job = {
  progress: DeathReviewProgress;
  signature: string;
  matches: DeathMatchDescriptor[];
  ready: Set<string>;
  controller: AbortController;
};
type Inspection = {
  records: DeathReviewRecord[];
  ready: Set<string>;
  errors: DeathReviewProgress['errors'];
};

function validate(payload: FetchDeathReviewPage) {
  if (
    !payload ||
    typeof payload.steamId !== 'string' ||
    !/^\d{17}$/.test(payload.steamId) ||
    (payload.checksum !== undefined &&
      (typeof payload.checksum !== 'string' || !/^[a-f0-9]{1,64}$/.test(payload.checksum))) ||
    (payload.mapName !== undefined && (typeof payload.mapName !== 'string' || payload.mapName.length > 128)) ||
    (payload.source !== undefined && !Object.values(DemoSource).includes(payload.source)) ||
    (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT) ||
    (payload.page !== undefined && (!Number.isSafeInteger(payload.page) || payload.page < 0)) ||
    (payload.kind !== undefined && !['enemy', 'team', 'self', 'world', 'unknown'].includes(payload.kind)) ||
    (payload.filter !== undefined && !['all', 'flagged', 'needs-data'].includes(payload.filter)) ||
    (payload.findingCode !== undefined &&
      (typeof payload.findingCode !== 'string' || !/^[a-z0-9_-]{1,100}$/.test(payload.findingCode)))
  )
    throw new Error('Invalid death review filters');
}

function scopeId(scope: DeathReviewScope) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        scope.steamId,
        scope.checksum ?? null,
        scope.mapName ?? null,
        scope.source ?? null,
        scope.side ?? null,
      ]),
    )
    .digest('hex');
}

function signature(matches: DeathMatchDescriptor[]) {
  return createHash('sha256').update(matches.map(deathMatchRevision).sort().join(':')).digest('hex');
}

function reason(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** One global worker bounds database use even when multiple dashboard scopes request missing files. */
export class DeathReviewService {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private draining = false;

  constructor(private dependencies: Dependencies) {}

  isBusy() {
    return this.draining || this.queue.length > 0;
  }

  private emit(job: Job) {
    if (this.jobs.get(job.progress.id) === job) this.dependencies.changed(structuredClone(job.progress));
  }

  private async inspect(matches: DeathMatchDescriptor[]): Promise<Inspection> {
    const result: Inspection = { records: [], ready: new Set(), errors: [] };
    for (const match of matches) {
      try {
        const records = await this.dependencies.read(match);
        if (records !== undefined) {
          result.ready.add(match.checksum);
          result.records.push(...records);
        }
      } catch (error) {
        result.errors.push({ checksum: match.checksum, reason: reason(error) });
      }
    }
    return result;
  }

  private createJob(scope: DeathReviewScope, matches: DeathMatchDescriptor[], inspected: Inspection) {
    const id = scopeId(scope);
    const job: Job = {
      signature: signature(matches),
      matches,
      ready: inspected.ready,
      controller: new AbortController(),
      progress: {
        id,
        steamId: scope.steamId,
        status: 'idle',
        total: matches.length,
        completed: inspected.ready.size,
        failed: inspected.errors.length,
        errors: inspected.errors,
      },
    };
    this.jobs.set(id, job);
    if (job.progress.completed + job.progress.failed === matches.length) {
      job.progress.status = 'completed';
    } else if (this.dependencies.canStart()) {
      job.progress.status = 'running';
      this.queue.push(job);
      void this.drain();
    }
    return job;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      let job: Job | undefined;
      while ((job = this.queue.shift())) {
        if (job.controller.signal.aborted) continue;
        for (const match of job.matches) {
          const signal = job.controller.signal;
          if (signal.aborted) break;
          if (job.ready.has(match.checksum) || job.progress.errors.some((error) => error.checksum === match.checksum))
            continue;
          if (!this.dependencies.canStart()) {
            job.progress.status = 'canceled';
            job.controller.abort();
            break;
          }
          job.progress.currentChecksum = match.checksum;
          job.progress.currentDemoName = match.name;
          this.emit(job);
          const generation = getDemoCacheGeneration(match.checksum);
          try {
            // Another scope may already have produced this all-player file while this job was waiting.
            const cached = await this.dependencies.read(match);
            signal.throwIfAborted();
            if (!(await this.dependencies.isCurrent(match)))
              throw new Error('Match changed while preparing death review; retry this match');
            signal.throwIfAborted();
            if (cached === undefined) {
              const records = await this.dependencies.build(match, signal);
              signal.throwIfAborted();
              if (!(await this.dependencies.isCurrent(match)))
                throw new Error('Match changed while preparing death review; retry this match');
              signal.throwIfAborted();
              await this.dependencies.write(match, records, signal, generation);
            }
            signal.throwIfAborted();
            job.ready.add(match.checksum);
            job.progress.completed = job.ready.size;
          } catch (error) {
            if (signal.aborted) break;
            job.progress.errors.push({ checksum: match.checksum, reason: reason(error) });
            job.progress.failed = job.progress.errors.length;
          }
          this.emit(job);
        }
        delete job.progress.currentChecksum;
        delete job.progress.currentDemoName;
        if (job.progress.status !== 'canceled') job.progress.status = 'completed';
        this.emit(job);
      }
    } finally {
      this.draining = false;
    }
  }

  async fetch(payload: FetchDeathReviewPage): Promise<DeathReviewPage> {
    validate(payload);
    const matches = await this.dependencies.listMatches(payload);
    let inspected = await this.inspect(matches);
    const id = scopeId(payload);
    let job = this.jobs.get(id);
    if (job?.progress.status === 'canceled' && job.signature !== signature(matches)) {
      const selected = new Set(matches.map((match) => match.checksum));
      job.matches = matches;
      job.signature = signature(matches);
      job.ready = inspected.ready;
      job.progress.total = matches.length;
      job.progress.completed = inspected.ready.size;
      job.progress.errors = job.progress.errors.filter(
        (error) => selected.has(error.checksum) && !inspected.ready.has(error.checksum),
      );
      job.progress.failed = job.progress.errors.length;
    }
    if (job?.progress.status === 'completed' && job.ready.size > inspected.ready.size) {
      // The worker may finish during a cache read; return the completed files with its completed status.
      inspected = await this.inspect(matches);
    }
    if (
      !job ||
      (job.progress.status !== 'running' &&
        job.progress.status !== 'canceled' &&
        job.signature !== signature(matches)) ||
      (job.progress.status === 'completed' && job.progress.failed === 0 && inspected.ready.size < matches.length) ||
      (job.progress.status === 'idle' && this.dependencies.canStart())
    )
      job = this.createJob(payload, matches, inspected);
    const failed = new Map(inspected.errors.map((error) => [error.checksum, error]));
    const selected = new Set(matches.map((match) => match.checksum));
    for (const error of job.progress.errors) {
      if (selected.has(error.checksum) && !inspected.ready.has(error.checksum)) failed.set(error.checksum, error);
    }
    const all = inspected.records
      .filter(
        (record) => record.steamId === payload.steamId && (payload.side === undefined || record.side === payload.side),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.checksum.localeCompare(b.checksum) ||
          a.roundNumber - b.roundNumber ||
          a.eventTick - b.eventTick ||
          a.id.localeCompare(b.id),
      );
    const hasRisk = (record: DeathReviewRecord) => (record.risk?.findings.length ?? 0) > 0;
    const needsEvidence = (record: DeathReviewRecord) =>
      record.kind === 'enemy' && record.evaluatedRules.length > 0 && record.risk?.status !== 'evaluated';
    const flagged = all.filter(hasRisk);
    const needsData = all.filter(needsEvidence);
    const filtered = all.filter(
      (record) =>
        (payload.kind === undefined || record.kind === payload.kind) &&
        (payload.findingCode === undefined ||
          record.findings.some((finding) => finding.code === payload.findingCode) ||
          record.risk?.findings.some(
            (finding) =>
              finding.ruleId === payload.findingCode ||
              finding.relatedRuleIds.some((ruleId) => ruleId === payload.findingCode),
          )) &&
        (payload.filter !== 'flagged' || hasRisk(record)) &&
        (payload.filter !== 'needs-data' || needsEvidence(record)),
    );
    const pageSize = 20;
    const page = Math.min(payload.page ?? 0, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    return {
      items: filtered.slice(page * pageSize, (page + 1) * pageSize),
      page,
      pageSize,
      total: filtered.length,
      totals: {
        deaths: all.length,
        flagged: flagged.length,
        needsData: needsData.length,
        analyzed: all.filter((record) => record.risk !== undefined).length,
      },
      coverage: {
        availableMatches: matches.length,
        readyMatches: inspected.ready.size,
        missingMatches: matches.length - inspected.ready.size - failed.size,
        failedMatches: failed.size,
      },
      progress: structuredClone(job.progress),
    };
  }

  async control(payload: ControlDeathReview): Promise<DeathReviewProgress> {
    validate(payload);
    if (!['cancel', 'retry'].includes(payload.action)) throw new Error('Invalid death review action');
    const current = this.jobs.get(scopeId(payload));
    if (payload.action === 'cancel') {
      if (current) {
        current.controller.abort();
        current.progress.status = 'canceled';
        this.emit(current);
        return structuredClone(current.progress);
      }
      const inspected = { records: [], ready: new Set<string>(), errors: [] };
      const job = this.createJob(payload, [], inspected);
      job.progress.status = 'canceled';
      job.controller.abort();
      return structuredClone(job.progress);
    }
    if (current?.progress.status === 'running') return structuredClone(current.progress);
    if (!this.dependencies.canStart()) throw new Error('Application update is in progress');
    const matches = await this.dependencies.listMatches(payload);
    const inspected = await this.inspect(matches);
    const latest = this.jobs.get(scopeId(payload));
    if (latest !== current && latest?.progress.status === 'running') return structuredClone(latest.progress);
    const job = this.createJob(payload, matches, inspected);
    this.emit(job);
    return structuredClone(job.progress);
  }
}
