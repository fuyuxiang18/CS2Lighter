import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { ReviewBatch, ReviewBatchRequest } from 'csdm/common/types/review-batch';
import type { ResolvedReviewBatch } from './resolve-review-batch';
import { RecordingQueueService } from './recording-queue-service';

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-queue-'));
});
afterEach(async () => {
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe cleanup');
  await fs.rm(directory, { recursive: true, force: true });
});
function fixture() {
  const request: ReviewBatchRequest = {
    includeOpponent: true,
    clips: [1, 2].map((roundNumber) => ({
      checksum: String(roundNumber),
      steamId: '76561198000000001',
      roundNumber,
      startTick: 1000,
      endTick: 1200,
    })),
  };
  const resolve = vi.fn((input: ReviewBatchRequest): Promise<ResolvedReviewBatch> => {
    const items = input.clips.map((clip, index) => ({
      input: {
        request: { ...clip, endTick: clip.endTick! },
        demoPath: `/fixtures/demo-${clip.checksum}.dem`,
        playerName: 'Synthetic player',
        mapName: 'de_inferno',
        tickrate: 64,
        revision: '1',
      },
      slots: {},
      item: {
        index: index + 1,
        request: clip,
        mapName: 'de_inferno',
        tickrate: 64,
        status: 'queued' as const,
        opponentUnavailable: true,
        opponentSteamId: clip.opponentSteamId,
        segments: [
          {
            index: index + 1,
            perspective: 'player' as const,
            steamId: clip.steamId,
            playerName: 'Synthetic player',
            startTick: clip.startTick,
            endTick: clip.endTick!,
            truncatedAtDeath: false,
            status: 'queued' as const,
          },
        ],
      },
    }));
    return Promise.resolve({ id: 'a'.repeat(64), request: input, items, groups: items.map((item) => [item]) });
  });
  let batch: ReviewBatch;
  const dependencies = {
    directory: () => directory,
    resolve,
    generate: vi.fn(async (input: ReviewBatchRequest) => {
      const plan = await resolve(input);
      batch = {
        schemaVersion: 1,
        id: plan.id,
        status: 'preparing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        includeOpponent: true,
        items: plan.items.map(({ item }) => item),
        demoCount: plan.groups.length,
        completedDemos: 0,
        completedSegments: 0,
        totalSegments: plan.items.length,
        launchCount: 0,
        sourceMetadata: { format: 'cs2lighter-review-batch-v1', source: 'cs2-demo-render', includeOpponent: true },
      };
      return { batch };
    }),
    listBatches: vi.fn((): Promise<ReviewBatch[]> => Promise.resolve([])),
    cancel: vi.fn(),
    pause: vi.fn(),
    changed: vi.fn(),
  };
  return {
    request,
    dependencies,
    service: new RecordingQueueService(dependencies),
    batch: () => structuredClone(batch),
  };
}

it('serializes duplicate adds, persists waiting entries and never launches on add or restart', async () => {
  const { service, request, dependencies } = fixture();
  await Promise.all([service.add(request), service.add(request)]);
  const restored = await new RecordingQueueService(dependencies).get();
  expect(restored.items).toHaveLength(2);
  expect(restored.items.map((item) => item.status)).toEqual(['pending', 'pending']);
  expect(restored.running).toBe(false);
  expect(dependencies.generate).not.toHaveBeenCalled();
});
it('starts only selected waiting entries; pause leaves unstarted entries durable and ready media retained', async () => {
  const { service, request, dependencies, batch } = fixture();
  const added = await service.add(request);
  const ids = added.items.map((item) => item.id);
  await service.control({ action: 'start', ids });
  expect(dependencies.generate).toHaveBeenCalledTimes(1);
  await service.control({ action: 'pause' });
  expect(dependencies.pause).toHaveBeenCalledWith('a'.repeat(64));
  const partial = batch();
  partial.status = 'canceled';
  partial.items[0].status = 'ready';
  partial.items[0].videoUrl = 'file:///controlled.mp4';
  await service.updateBatch(partial);
  expect((await service.get()).items.map((item) => item.status)).toEqual(['ready', 'pending']);
  await service.control({ action: 'remove', ids });
  expect((await service.get()).items).toEqual([]);
  expect((await service.get()).running).toBe(false);
});
it('cancel affects the owned batch, marks the current event canceled, and retries require a fresh Start', async () => {
  const { service, request, dependencies, batch } = fixture();
  const added = await service.add(request);
  const ids = [added.items[0].id];
  await service.control({ action: 'start', ids });
  expect(dependencies.generate.mock.calls[0][0].clips).toHaveLength(1);
  await service.control({ action: 'cancel' });
  expect(dependencies.cancel).toHaveBeenCalledWith('a'.repeat(64));
  const canceled = batch();
  canceled.status = 'canceled';
  canceled.items[0].status = 'canceled';
  await service.updateBatch(canceled);
  await service.control({ action: 'retry', ids });
  expect((await service.get()).items.map((item) => item.status)).toEqual(['pending', 'pending']);
  expect(dependencies.generate).toHaveBeenCalledTimes(1);
});
it('restart reconciles committed event files, marks interrupted events failed and never resumes them', async () => {
  const { service, request, dependencies, batch } = fixture();
  const added = await service.add(request);
  await service.control({ action: 'start', ids: added.items.map((item) => item.id) });
  const saved = batch();
  saved.status = 'failed';
  saved.items[0].status = 'ready';
  saved.items[0].videoUrl = 'file:///controlled.mp4';
  dependencies.listBatches.mockResolvedValue([saved]);
  const restored = await new RecordingQueueService(dependencies).get();
  expect(restored.running).toBe(false);
  expect(restored.items.map((item) => [item.status, item.issue])).toEqual([
    ['ready', undefined],
    ['failed', 'interrupted'],
  ]);
  expect(dependencies.generate).toHaveBeenCalledTimes(1);
});
it('reuses matching ready media when adding an event and preserves malformed queues rather than overwriting them', async () => {
  const { service, request, dependencies, batch } = fixture();
  await dependencies.generate(request);
  const saved = batch();
  saved.status = 'ready';
  saved.items.forEach((item) => {
    item.status = 'ready';
    item.videoUrl = 'file:///controlled.mp4';
  });
  dependencies.listBatches.mockResolvedValue([saved]);
  const added = await service.add(request);
  expect(added.items.every((item) => item.status === 'ready')).toBe(true);
  const file = path.join(directory, 'queue.json');
  await fs.writeFile(file, '{incomplete');
  await expect(new RecordingQueueService(dependencies).add(request)).rejects.toThrow();
  expect(await fs.readFile(file, 'utf8')).toBe('{incomplete');
});

it('keeps player-only, opponent POV and different opponents separate when assigning cached or active results', async () => {
  const { service, request, dependencies, batch } = fixture();
  const clip = request.clips[0];
  await service.add({ clips: [{ ...clip, opponentSteamId: '76561198000000002' }], includeOpponent: false });
  await service.add({ clips: [{ ...clip, opponentSteamId: '76561198000000002' }], includeOpponent: true });
  const added = await service.add({
    clips: [{ ...clip, opponentSteamId: '76561198000000003' }],
    includeOpponent: true,
  });
  expect(added.items).toHaveLength(3);
  await service.control({ action: 'start', ids: added.items.map((item) => item.id) });
  const running = await service.get();
  expect(running.items.map((item) => item.batchItemIndex)).toEqual([1, 2, 3]);
  const partial = batch();
  partial.status = 'failed';
  partial.items[0].status = 'ready';
  partial.items[0].videoUrl = 'file:///player.mp4';
  partial.items[1].status = 'failed';
  partial.items[2].status = 'ready';
  partial.items[2].videoUrl = 'file:///other.mp4';
  await service.updateBatch(partial);
  expect((await service.get()).items.map((item) => item.status)).toEqual(['ready', 'failed', 'ready']);
  expect(dependencies.generate).toHaveBeenCalledTimes(1);
  expect(service.isBusy()).toBe(false);
});
