import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { resolveVideoAiMedia } from './resolve-video-ai-media';

const fixture = vi.hoisted(() => ({
  directory: '',
  deaths: [] as {
    tick: number;
    victim_steam_id: string;
    killer_steam_id: string;
    killer_side: number;
    victim_side: number;
  }[],
  batch: undefined as unknown,
  inspect: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('csdm/node/filesystem/get-app-folder-path', () => ({ getAppFolderPath: () => fixture.directory }));
vi.mock('./review-clips', () => ({ reviewClips: { inspect: fixture.inspect } }));
vi.mock('./review-batches', () => ({
  reviewBatches: { get: () => Promise.resolve(fixture.batch) },
  reviewBatchDirectory: () => path.join(fixture.directory, 'review-batches'),
}));
vi.mock('./resolve-review-clip', () => ({ resolveReviewClip: fixture.resolve }));
vi.mock('csdm/node/database/database', () => ({
  db: {
    selectFrom: () => {
      const query = {
        select: () => query,
        where: () => query,
        whereRef: () => query,
        orderBy: () => query,
        execute: () => Promise.resolve(fixture.deaths),
        executeTakeFirst: () => Promise.resolve(undefined),
      };
      return query;
    },
  },
}));
const id = 'a'.repeat(64);
const player = '76561198000000001';
const opponent = '76561198000000002';
const request = { checksum: 'abc', steamId: player, roundNumber: 1, startTick: 1000, endTick: 1640 };
beforeEach(async () => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-ai-media-'));
  fixture.deaths = [{ tick: 1320, victim_steam_id: player, killer_steam_id: opponent, killer_side: 2, victim_side: 3 }];
  fixture.resolve.mockResolvedValue({ request, mapName: 'de_inferno', tickrate: 64, revision: 'revision' });
  fixture.inspect.mockResolvedValue({
    clip: { id, status: 'ready', updatedAt: 'date', videoUrl: 'file:///untrusted/other.mp4' },
  });
  const folder = path.join(fixture.directory, 'review-clips', id);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'clip.mp4'), 'synthetic test media');
});
afterEach(async () => {
  await fs.rm(fixture.directory, { recursive: true, force: true });
});
it('only exposes the controlled legacy file and excludes death and any later spectator camera', async () => {
  const media = await resolveVideoAiMedia({ kind: 'clip', request });
  expect(media.eventTick).toBe(1320);
  expect(media.segments).toEqual([
    {
      perspective: 'player',
      filePath: path.join(fixture.directory, 'review-clips', id, 'clip.mp4'),
      startTick: 1000,
      endTick: 1319,
      offsetSeconds: 0,
      durationSeconds: 319 / 64,
    },
  ]);
});
it('rejects legacy footage if the requested player was dead before capture started', async () => {
  fixture.deaths[0].tick = 900;
  await expect(resolveVideoAiMedia({ kind: 'clip', request })).rejects.toMatchObject({ issue: 'invalid-request' });
});
it('uses the manifest item index directly and retains separate trusted offsets and survival limits', async () => {
  const folder = path.join(fixture.directory, 'review-batches', id);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'event-2.mp4'), 'synthetic edited event');
  fixture.batch = {
    id,
    updatedAt: 'date',
    items: [
      {
        index: 2,
        status: 'ready',
        request,
        eventTick: 1320,
        videoUrl: 'file:///untrusted.mp4',
        segments: [
          {
            perspective: 'player',
            steamId: player,
            startTick: 1000,
            endTick: 1319,
            offsetSeconds: 0,
            durationSeconds: 5,
          },
          {
            perspective: 'opponent',
            steamId: opponent,
            startTick: 1000,
            endTick: 1640,
            offsetSeconds: 5,
            durationSeconds: 10,
          },
        ],
      },
    ],
  };
  const media = await resolveVideoAiMedia({ kind: 'batch', id, itemIndex: 2 });
  expect(media.eventTick).toBe(1320);
  expect(
    media.segments.map((segment) => [segment.perspective, segment.offsetSeconds, segment.durationSeconds]),
  ).toEqual([
    ['player', 0, 319 / 64],
    ['opponent', 5, 10],
  ]);
  expect(media.segments.every((segment) => segment.filePath === path.join(folder, 'event-2.mp4'))).toBe(true);
  await expect(resolveVideoAiMedia({ kind: 'batch', id, itemIndex: 1 })).rejects.toMatchObject({
    issue: 'output-missing',
  });
});
it('rejects missing media instead of preparing frames from a manifest-only success', async () => {
  await fs.unlink(path.join(fixture.directory, 'review-clips', id, 'clip.mp4'));
  await expect(resolveVideoAiMedia({ kind: 'clip', request })).rejects.toMatchObject({ issue: 'output-missing' });
});
