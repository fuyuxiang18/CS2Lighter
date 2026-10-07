import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import type { ReviewBatch, ReviewBatchItem } from 'csdm/common/types/review-batch';
import type { ReviewClipRequirements } from 'csdm/common/types/review-clip';
import { ReviewBatchService } from './review-batch-service';
import type { ResolvedReviewBatch, ResolvedBatchItem } from './resolve-review-batch';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-batch-'));
});
afterEach(async () => {
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe test cleanup');
  await fs.rm(directory, { recursive: true, force: true });
});
vi.stubGlobal('logger', { error: vi.fn() });
const ready: ReviewClipRequirements = {
  supportedPlatform: true,
  cs2Installed: true,
  hlaeInstalled: true,
  ffmpegInstalled: true,
  steamRunning: true,
  gameRunning: false,
  queueBusy: false,
  missingReasons: [],
};
function setup() {
  const items: ResolvedBatchItem[] = [1, 2].map((index) => {
    const request = {
      checksum: 'abc',
      steamId: '76561198000000001',
      roundNumber: index,
      startTick: index * 1000,
      endTick: index * 1000 + 640,
    };
    const item: ReviewBatchItem = {
      index,
      request,
      mapName: 'de_inferno',
      tickrate: 64,
      opponentUnavailable: false,
      status: 'queued',
      segments: [
        {
          index,
          perspective: 'player',
          steamId: request.steamId,
          playerName: 'Player',
          startTick: request.startTick,
          endTick: request.endTick,
          truncatedAtDeath: false,
          status: 'queued',
        },
      ],
    };
    return {
      item,
      input: {
        request,
        demoPath: '/read-only/demo.dem',
        mapName: item.mapName,
        tickrate: 64,
        playerName: 'Player',
        revision: 'revision',
      },
      slots: {},
    };
  });
  const plan: ResolvedReviewBatch = {
    id: 'a'.repeat(64),
    request: { clips: items.map(({ item }) => item.request), includeOpponent: false },
    items,
    groups: [items],
  };
  const changes: ReviewBatch[] = [];
  const dependencies = {
    directory: () => directory,
    resolve: vi.fn(() => Promise.resolve(plan)),
    requirements: vi.fn(() => Promise.resolve(ready)),
    busy: () => false,
    recordSession: vi.fn(
      async (
        groups: ResolvedBatchItem[][],
        _folder: string,
        _signal: AbortSignal,
        progress: (index: number, encoding: boolean) => void,
        launched: () => void,
        recorded: (item: ResolvedBatchItem, folder: string, signal: AbortSignal) => Promise<void>,
        shouldPause: () => boolean,
      ) => {
        launched();
        for (const group of groups)
          for (const item of group) {
            if (shouldPause()) return;
            progress(item.item.segments[0].index, false);
            await recorded(item, _folder, _signal);
          }
      },
    ),
    editItem: vi.fn(async (item: ReviewBatchItem, _folder: string, output: string) => {
      await fs.writeFile(output, 'unit-test synthetic media');
      return {
        ...item,
        durationSeconds: 10,
        segments: item.segments.map((segment) => ({
          ...segment,
          status: 'ready' as const,
          offsetSeconds: 0,
          durationSeconds: 10,
        })),
      };
    }),
    concatenate: vi.fn(async (_files: string[], output: string) => {
      await fs.writeFile(output, 'unit-test compilation');
    }),
    changed: (batch: ReviewBatch) => changes.push(batch),
  };
  return { service: new ReviewBatchService(dependencies), dependencies, plan, changes };
}
it('records one demo once for multiple events and only reports ready after compiled outputs exist', async () => {
  const { service, dependencies, plan, changes } = setup();
  const [a, b] = await Promise.all([service.generate(plan.request), service.generate(plan.request)]);
  expect(a.batch.id).toBe(b.batch.id);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  const result = (await service.get(plan.id))!;
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready' });
  expect(result.launchCount).toBe(1);
  expect(result.completedDemos).toBe(1);
  expect(result.completedSegments).toBe(2);
  expect(result.items.map((item) => item.offsetSeconds)).toEqual([0, 10]);
  expect(dependencies.recordSession).toHaveBeenCalledTimes(1);
  expect(changes.at(-1)?.status).toBe('ready');
  const restarted = new ReviewBatchService(dependencies);
  await restarted.generate(plan.request);
  expect(dependencies.recordSession).toHaveBeenCalledTimes(1);
});
it('keeps successfully edited events when another fails, then retries only missing events', async () => {
  const { service, dependencies, plan } = setup();
  const edit = dependencies.editItem.getMockImplementation()!;
  dependencies.editItem.mockImplementation(async (item, folder, output) => {
    if (item.index === 2) throw new Error('disk unavailable');
    return edit(item, folder, output);
  });
  await service.generate(plan.request);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect((await service.get(plan.id))?.items.map((item) => item.status)).toEqual(['ready', 'failed']);
  dependencies.editItem.mockImplementation(edit);
  await service.generate(plan.request);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect(dependencies.recordSession.mock.calls[1][0].flat().map(({ item }) => item.index)).toEqual([2]);
  expect((await service.get(plan.id))?.status).toBe('ready');
});
it('cancels the owned batch signal, unlocks only after it settles, and persists terminal state', async () => {
  const { service, dependencies, plan } = setup();
  let ownedSignal: AbortSignal | undefined;
  dependencies.recordSession.mockImplementation(
    (_items, _folder, signal) =>
      new Promise((resolve) => {
        ownedSignal = signal;
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
  );
  await service.generate(plan.request);
  await vi.waitFor(() => expect(ownedSignal).toBeDefined());
  service.cancel(plan.id);
  expect(ownedSignal?.aborted).toBe(true);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect((await new ReviewBatchService(dependencies).get(plan.id))?.status).toBe('canceled');
  expect(dependencies.editItem).not.toHaveBeenCalled();
});
it('does not trust stale ready flags or URLs when cached output is missing', async () => {
  const { service, dependencies, plan } = setup();
  await service.generate(plan.request);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  await fs.unlink(path.join(directory, plan.id, 'event-2.mp4'));
  const manifestPath = path.join(directory, plan.id, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.items[0].videoUrl = 'file:///outside/private.mp4';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const result = await new ReviewBatchService(dependencies).get(plan.id);
  expect(result?.status).toBe('failed');
  expect(result?.issue).toBe('output-missing');
  expect(result?.items[0].videoUrl).toContain('/event-1.mp4');
  expect(result?.items[1].videoUrl).toBeUndefined();
  expect(await service.get('../outside')).toBeUndefined();
});

it('marks a process-interrupted manifest as failed without claiming the recorder is still active', async () => {
  const { service, dependencies, plan } = setup();
  await service.generate(plan.request);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  const manifestPath = path.join(directory, plan.id, 'manifest.json');
  const saved = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  saved.status = 'recording';
  saved.items[1].status = 'recording';
  await fs.writeFile(manifestPath, JSON.stringify(saved));
  const restarted = new ReviewBatchService(dependencies);
  const batch = await restarted.get(plan.id);
  expect(restarted.isBusy()).toBe(false);
  expect(batch).toMatchObject({ status: 'failed', issue: 'interrupted' });
  expect(batch?.items.map((item) => item.status)).toEqual(['ready', 'failed']);
  expect(dependencies.recordSession).toHaveBeenCalledTimes(1);
});
