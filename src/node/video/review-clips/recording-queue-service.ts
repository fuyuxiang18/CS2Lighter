import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AddToRecordingQueue,
  ControlRecordingQueue,
  RecordingQueue,
  RecordingQueueItem,
} from 'csdm/common/types/recording-queue';
import type { ReviewBatch, ReviewBatchRequest, ReviewBattleRequest } from 'csdm/common/types/review-batch';
import type { ResolvedReviewBatch } from './resolve-review-batch';
import { ReviewClipError } from './review-clip-service';

type Dependencies = {
  directory: () => string;
  resolve: (request: ReviewBatchRequest) => Promise<ResolvedReviewBatch>;
  generate: (request: ReviewBatchRequest) => Promise<{ batch: ReviewBatch }>;
  listBatches: () => Promise<ReviewBatch[]>;
  cancel: (id: string) => void;
  pause: (id: string) => void;
  changed: (queue: RecordingQueue) => void;
};

function sameEvent(a: ReviewBattleRequest, b: ReviewBattleRequest) {
  return (
    a.checksum === b.checksum &&
    a.steamId === b.steamId &&
    a.roundNumber === b.roundNumber &&
    a.startTick === b.startTick &&
    a.endTick === b.endTick &&
    a.includeOpponent === b.includeOpponent &&
    a.opponentSteamId === b.opponentSteamId
  );
}

/** Waiting entries are durable data, not daemon work: loading this service never launches CS2. */
export class RecordingQueueService {
  private state?: RecordingQueue;
  private operations: Promise<unknown> = Promise.resolve();
  private activeOperations = 0;
  constructor(private dependencies: Dependencies) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.activeOperations++;
    const next = this.operations
      .catch(() => {})
      .then(operation)
      .finally(() => {
        this.activeOperations--;
      });
    this.operations = next;
    return next;
  }
  isBusy() {
    return this.state?.running === true || this.activeOperations > 0;
  }
  private async load(): Promise<RecordingQueue> {
    if (this.state) return this.state;
    try {
      const saved = JSON.parse(
        await fs.readFile(path.join(this.dependencies.directory(), 'queue.json'), 'utf8'),
      ) as RecordingQueue;
      if (
        saved.schemaVersion !== 1 ||
        !Array.isArray(saved.items) ||
        saved.items.some((item) => !/^[a-f0-9]{64}$/.test(item.id))
      )
        throw new Error('Invalid queue');
      this.state = {
        ...saved,
        running: false,
        pauseRequested: false,
        batch: undefined,
        items: saved.items.map((item) =>
          item.status === 'active' ? { ...item, status: 'failed', issue: 'interrupted' } : item,
        ),
      };
      // A completed manifest survives a crash between the media commit and the queue update.
      const batches = await this.dependencies.listBatches();
      for (const item of this.state.items) {
        const batch = batches.find((entry) => entry.id === item.batchId);
        const result = batch?.items.find((entry) => entry.index === item.batchItemIndex);
        if (result?.status === 'ready' && result.videoUrl) {
          item.status = 'ready';
          item.issue = undefined;
        } else if (item.status === 'ready') {
          item.status = 'failed';
          item.issue = 'output-missing';
        }
      }
    } catch (error) {
      this.state = undefined;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        items: [],
        running: false,
        pauseRequested: false,
      };
    }
    return this.state;
  }
  private async save() {
    const state = await this.load();
    state.updatedAt = new Date().toISOString();
    const directory = this.dependencies.directory();
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `queue-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify({ ...state, batch: undefined }));
      await fs.rename(temporary, path.join(directory, 'queue.json'));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    this.dependencies.changed(structuredClone(state));
    return structuredClone(state);
  }
  get() {
    return this.serialize(async () => structuredClone(await this.load()));
  }
  add(request: AddToRecordingQueue) {
    return this.serialize(async () => {
      const state = await this.load();
      const plan = await this.dependencies.resolve(request);
      const batches = await this.dependencies.listBatches();
      for (const { item, input, eventKind, opening } of plan.items) {
        const includeOpponent = item.request.includeOpponent ?? request.includeOpponent;
        const queueRequest = { ...item.request, includeOpponent, opponentSteamId: item.opponentSteamId };
        const id = createHash('sha256')
          .update(
            JSON.stringify([
              item.request.checksum,
              item.request.steamId,
              item.request.roundNumber,
              item.request.startTick,
              item.request.endTick,
              item.opponentSteamId,
              includeOpponent,
            ]),
          )
          .digest('hex');
        if (state.items.some((entry) => entry.id === id)) continue;
        const cached = batches
          .flatMap((batch) => batch.items.map((result) => ({ batch, result })))
          .find(
            ({ batch, result }) =>
              result.status === 'ready' &&
              result.videoUrl &&
              sameEvent(
                {
                  ...result.request,
                  includeOpponent: result.request.includeOpponent ?? batch.includeOpponent,
                  opponentSteamId: result.opponentSteamId,
                },
                queueRequest,
              ) &&
              (!includeOpponent ||
                result.segments.some((segment) => segment.perspective === 'opponent') ||
                result.opponentUnavailable),
          );
        if (state.items.length >= 1000) throw new ReviewClipError('invalid-request', 'The recording queue is full');
        state.items.push({
          id,
          request: queueRequest,
          includeOpponent,
          mapName: input.mapName,
          playerName: input.playerName,
          opponentName: item.opponentName,
          demoName: path.basename(input.demoPath),
          eventKind: eventKind ?? 'range',
          opening: opening ?? false,
          perspectives: item.segments.map((segment) => segment.perspective),
          addedAt: new Date().toISOString(),
          status: cached ? 'ready' : 'pending',
          batchId: cached?.batch.id,
          batchItemIndex: cached?.result.index,
        });
      }
      return this.save();
    });
  }
  control(control: ControlRecordingQueue) {
    return this.serialize(async () => {
      const state = await this.load();
      if (control.action === 'pause' || control.action === 'cancel') {
        if (state.running && state.batch) {
          state.pauseRequested = true;
          if (control.action === 'pause') this.dependencies.pause(state.batch.id);
          else this.dependencies.cancel(state.batch.id);
        }
        return this.save();
      }
      if (!('ids' in control) || !Array.isArray(control.ids) || control.ids.length > 1000)
        throw new ReviewClipError('invalid-request');
      const ids = new Set(control.ids);
      if (control.action === 'remove')
        state.items = state.items.filter((item) => !ids.has(item.id) || item.status === 'active');
      else if (control.action === 'retry') {
        for (const item of state.items)
          if (ids.has(item.id) && ['failed', 'canceled'].includes(item.status)) {
            item.status = 'pending';
            item.issue = undefined;
          }
      } else if (control.action === 'start') {
        if (state.running) throw new ReviewClipError('queue-busy');
        const selected = state.items.filter((item) => ids.has(item.id) && item.status === 'pending');
        if (!selected.length || selected.length > 20) throw new ReviewClipError('invalid-request');
        for (const item of selected) {
          item.status = 'active';
          item.issue = undefined;
        }
        state.running = true;
        state.pauseRequested = false;
        await this.save();
        try {
          const { batch } = await this.dependencies.generate({
            clips: selected.map((item) => ({ ...item.request, includeOpponent: item.includeOpponent })),
            includeOpponent: true,
          });
          this.applyBatch(state, batch, selected);
        } catch (error) {
          state.running = false;
          for (const item of selected) {
            item.status = 'failed';
            item.issue = error instanceof ReviewClipError ? error.issue : 'recording-failed';
          }
        }
      } else throw new ReviewClipError('invalid-request');
      return this.save();
    });
  }
  private applyBatch(state: RecordingQueue, batch: ReviewBatch, selected?: RecordingQueueItem[]) {
    state.batch = batch;
    const terminal = ['ready', 'failed', 'canceled'].includes(batch.status);
    for (const item of selected ??
      state.items.filter((entry) => entry.batchId === batch.id && entry.status !== 'ready')) {
      const result = batch.items.find((entry) => sameEvent(entry.request, item.request));
      if (!result) continue;
      item.batchId = batch.id;
      item.batchItemIndex = result.index;
      if (result.status === 'ready') item.status = 'ready';
      else if (terminal)
        item.status = result.status === 'queued' ? 'pending' : result.status === 'canceled' ? 'canceled' : 'failed';
      else item.status = 'active';
      item.issue = result.issue ?? (item.status === 'failed' ? batch.issue : undefined);
    }
    state.running = !terminal;
  }
  updateBatch(batch: ReviewBatch) {
    return this.serialize(async () => {
      const state = await this.load();
      if (state.batch?.id !== batch.id) return;
      this.applyBatch(state, batch);
      await this.save();
    });
  }
}
