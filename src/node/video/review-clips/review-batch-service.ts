import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type {
  ReviewBatch,
  ReviewBatchInspection,
  ReviewBatchItem,
  ReviewBatchRequest,
} from 'csdm/common/types/review-batch';
import type { ReviewClipRequirements } from 'csdm/common/types/review-clip';
import { sleep } from 'csdm/common/sleep';
import { ReviewClipError } from './review-clip-service';
import type { ResolvedBatchItem, ResolvedReviewBatch } from './resolve-review-batch';

type Dependencies = {
  directory: () => string;
  resolve: (request: ReviewBatchRequest) => Promise<ResolvedReviewBatch>;
  requirements: () => Promise<ReviewClipRequirements>;
  busy: () => boolean;
  recordSession: (
    groups: ResolvedBatchItem[][],
    folder: string,
    signal: AbortSignal,
    progress: (segment: number, encoding: boolean) => void,
    launched: () => void,
    itemRecorded: (item: ResolvedBatchItem, groupFolder: string, signal: AbortSignal) => Promise<void>,
    shouldPause: () => boolean,
  ) => Promise<void>;
  editItem: (
    item: ReviewBatchItem,
    groupFolder: string,
    outputFile: string,
    signal: AbortSignal,
  ) => Promise<ReviewBatchItem>;
  concatenate: (files: string[], destination: string, signal: AbortSignal) => Promise<void>;
  changed: (batch: ReviewBatch) => void;
};

const activeStatuses = new Set(['queued', 'preparing', 'recording', 'encoding']);

export class ReviewBatchService {
  private active?: { id: string; controller: AbortController; pause: boolean };
  private batches = new Map<string, ReviewBatch>();
  private writes = new Map<string, Promise<void>>();
  constructor(private dependencies: Dependencies) {}
  isBusy() {
    return this.active !== undefined;
  }
  private folder(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ReviewClipError('invalid-request');
    return path.join(this.dependencies.directory(), id);
  }
  private async playable(file: string) {
    return fs
      .stat(file)
      .then((stat) => stat.isFile() && stat.size > 0)
      .catch(() => false);
  }
  private async expose(batch: ReviewBatch): Promise<ReviewBatch> {
    const folder = this.folder(batch.id);
    const items = await Promise.all(
      batch.items.map(async (item) => {
        if (item.status !== 'ready') return { ...item, videoUrl: undefined };
        const file = path.join(folder, `event-${item.index}.mp4`);
        return (await this.playable(file))
          ? { ...item, videoUrl: pathToFileURL(file).href }
          : { ...item, status: 'failed' as const, issue: 'output-missing' as const, videoUrl: undefined };
      }),
    );
    const file = path.join(folder, 'batch.mp4');
    if (batch.status === 'ready' && (items.some((item) => item.status !== 'ready') || !(await this.playable(file))))
      return { ...batch, items, status: 'failed', issue: 'output-missing', videoUrl: undefined };
    return { ...batch, items, videoUrl: batch.status === 'ready' ? pathToFileURL(file).href : undefined };
  }
  async get(id: string): Promise<ReviewBatch | undefined> {
    let batch = this.batches.get(id);
    if (!batch) {
      try {
        batch = JSON.parse(await fs.readFile(path.join(this.folder(id), 'manifest.json'), 'utf8')) as ReviewBatch;
        if (
          batch.schemaVersion !== 1 ||
          batch.id !== id ||
          !Array.isArray(batch.items) ||
          batch.items.some((item) => !Number.isSafeInteger(item.index) || item.index < 1)
        )
          return undefined;
        if (activeStatuses.has(batch.status) && this.active?.id !== id)
          batch = {
            ...batch,
            status: 'failed',
            issue: 'interrupted',
            items: batch.items.map((item) =>
              activeStatuses.has(item.status) ? { ...item, status: 'failed', issue: 'interrupted' } : item,
            ),
          };
      } catch {
        return undefined;
      }
    }
    const exposed = await this.expose(batch);
    this.batches.set(id, exposed);
    return exposed;
  }
  async list(): Promise<ReviewBatch[]> {
    const names = await fs.readdir(this.dependencies.directory()).catch(() => [] as string[]);
    const batches = await Promise.all(
      names.filter((name) => /^[a-f0-9]{64}$/.test(name)).map((name) => this.get(name)),
    );
    return batches
      .filter((batch): batch is ReviewBatch => batch !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async inspect(id: string): Promise<ReviewBatchInspection | undefined> {
    const batch = await this.get(id);
    return batch ? { batch, requirements: await this.dependencies.requirements() } : undefined;
  }
  private async save(batch: ReviewBatch): Promise<void> {
    const folder = this.folder(batch.id);
    const snapshot = JSON.stringify({
      ...batch,
      videoUrl: undefined,
      items: batch.items.map((item) => ({ ...item, videoUrl: undefined })),
    });
    const write = (this.writes.get(batch.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(folder, { recursive: true });
        const temporary = path.join(folder, `manifest-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, snapshot);
          // Windows scanners can briefly hold a newly written manifest. Keep the previous valid file intact.
          for (let attempt = 0; ; attempt++) {
            try {
              await fs.rename(temporary, path.join(folder, 'manifest.json'));
              break;
            } catch (error) {
              if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? ''))
                throw error;
              await sleep(25 * 2 ** attempt);
            }
          }
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
      });
    this.writes.set(batch.id, write);
    await write;
  }
  private publish(batch: ReviewBatch) {
    batch.updatedAt = new Date().toISOString();
    this.batches.set(batch.id, structuredClone(batch));
    this.dependencies.changed(structuredClone(batch));
  }
  async generate(request: ReviewBatchRequest): Promise<ReviewBatchInspection> {
    const plan = await this.dependencies.resolve(request);
    const saved = await this.get(plan.id);
    const requirements = await this.dependencies.requirements();
    if (saved?.status === 'ready') return { batch: saved, requirements };
    if (this.active?.id === plan.id) {
      await this.writes.get(plan.id);
      const running = await this.get(plan.id);
      if (running) return { batch: running, requirements };
    }
    const now = new Date().toISOString();
    const batch: ReviewBatch = {
      schemaVersion: 1,
      id: plan.id,
      createdAt: saved?.createdAt ?? now,
      updatedAt: now,
      includeOpponent: request.includeOpponent,
      status: 'queued',
      items: plan.items.map(
        ({ item }) =>
          saved?.items.find((old) => old.index === item.index && old.status === 'ready') ?? structuredClone(item),
      ),
      demoCount: plan.groups.length,
      completedDemos: 0,
      totalSegments: plan.items.reduce((sum, { item }) => sum + item.segments.length, 0),
      completedSegments: 0,
      launchCount: 0,
      sourceMetadata: {
        format: 'cs2lighter-review-batch-v1',
        source: 'cs2-demo-render',
        includeOpponent: request.includeOpponent,
      },
    };
    if (this.active || this.dependencies.busy() || requirements.missingReasons.length > 0) {
      batch.status = 'failed';
      batch.issue = this.active || this.dependencies.busy() ? 'queue-busy' : requirements.missingReasons[0];
      await this.save(batch);
      this.publish(batch);
      return { batch, requirements };
    }
    const controller = new AbortController();
    this.active = { id: batch.id, controller, pause: false };
    try {
      await this.save(batch);
    } catch (error) {
      this.active = undefined;
      throw error;
    }
    this.publish(batch);
    void this.run(plan, batch, controller);
    return { batch: structuredClone(batch), requirements };
  }
  cancel(id: string): ReviewBatch | undefined {
    this.folder(id);
    if (this.active?.id === id) this.active.controller.abort();
    return this.batches.get(id);
  }
  pause(id: string): void {
    this.folder(id);
    if (this.active?.id === id) this.active.pause = true;
  }
  private async run(plan: ResolvedReviewBatch, batch: ReviewBatch, controller: AbortController) {
    const signal = controller.signal;
    const folder = this.folder(batch.id);
    try {
      const groups = plan.groups.map((group) =>
        group.filter(({ item }) => batch.items[item.index - 1].status !== 'ready'),
      );
      const pending = groups.flat();
      if (pending.length) {
        batch.status = 'preparing';
        this.publish(batch);
        await this.dependencies.recordSession(
          groups,
          folder,
          signal,
          (segmentIndex, encoding) => {
            if (signal.aborted) return;
            batch.status = encoding ? 'encoding' : 'recording';
            batch.currentSegment = segmentIndex;
            batch.currentDemo =
              plan.groups.findIndex((group) =>
                group.some(({ item }) => item.segments.some((segment) => segment.index === segmentIndex)),
              ) + 1;
            for (const item of batch.items)
              for (const segment of item.segments)
                if (item.status !== 'ready' && segment.index === segmentIndex) {
                  segment.status = batch.status;
                  item.status = batch.status;
                }
            this.publish(batch);
          },
          () => {
            batch.launchCount++;
            this.publish(batch);
          },
          async ({ item }, groupFolder, encodingSignal) => {
            if (signal.aborted || encodingSignal.aborted) throw new ReviewClipError('interrupted');
            // Commit each event before permitting the game to advance. A later failure cannot lose ready media.
            if (item.status === 'failed') {
              batch.items[item.index - 1] = { ...item };
            } else {
              batch.status = 'encoding';
              this.publish(batch);
              try {
                const output = path.join(folder, `event-${item.index}.mp4`);
                const edited = await this.dependencies.editItem(item, groupFolder, output, encodingSignal);
                batch.items[item.index - 1] = { ...edited, status: 'ready', videoUrl: pathToFileURL(output).href };
              } catch (error) {
                if (signal.aborted || encodingSignal.aborted) throw error;
                batch.items[item.index - 1] = {
                  ...item,
                  status: 'failed',
                  issue: 'recording-failed',
                  errorDetail: error instanceof Error ? error.message : String(error),
                };
              }
            }
            batch.completedSegments = batch.items
              .filter((entry) => entry.status === 'ready')
              .reduce((sum, entry) => sum + entry.segments.length, 0);
            batch.completedDemos = plan.groups.filter((group) =>
              group.every(({ item: entry }) => ['ready', 'failed'].includes(batch.items[entry.index - 1].status)),
            ).length;
            await this.save(batch);
            this.publish(batch);
          },
          () => this.active?.pause === true,
        );
      }
      if (signal.aborted) throw new ReviewClipError('interrupted');
      if (batch.items.some((item) => item.status !== 'ready')) {
        batch.status = this.active?.pause ? 'canceled' : 'failed';
        batch.issue = this.active?.pause ? undefined : 'recording-failed';
      } else {
        batch.status = 'encoding';
        this.publish(batch);
        let offset = 0;
        for (const item of batch.items) {
          item.offsetSeconds = offset;
          offset += item.durationSeconds ?? 0;
        }
        await this.dependencies.concatenate(
          batch.items.map((item) => path.join(folder, `event-${item.index}.mp4`)),
          path.join(folder, 'batch.mp4'),
          signal,
        );
        batch.status = 'ready';
        batch.videoUrl = pathToFileURL(path.join(folder, 'batch.mp4')).href;
      }
    } catch (error) {
      batch.status = signal.aborted ? 'canceled' : 'failed';
      batch.issue = signal.aborted ? undefined : 'recording-failed';
      batch.errorDetail = signal.aborted ? undefined : error instanceof Error ? error.message : String(error);
      batch.items = batch.items.map((item) =>
        item.status === 'ready' || item.status === 'failed' || (signal.aborted && item.status === 'queued')
          ? item
          : {
              ...item,
              status: batch.status,
              segments: item.segments.map((segment) => ({ ...segment, status: batch.status })),
            },
      );
    } finally {
      for (let index = 0; index < plan.groups.length; index++) {
        const staging = path.join(folder, `demo-${index + 1}`);
        if (path.dirname(staging) === folder)
          await fs
            .rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
            .catch((error) => logger.error(error));
      }
      batch.currentDemo = undefined;
      batch.currentSegment = undefined;
      try {
        await this.save(batch);
      } catch (error) {
        logger.error(error);
        batch.status = 'failed';
        batch.issue = 'recording-failed';
      }
      this.active = undefined;
      this.publish(batch);
    }
  }
}
