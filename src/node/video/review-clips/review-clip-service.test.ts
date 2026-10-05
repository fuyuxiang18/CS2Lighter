import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ReviewClip, ReviewClipRequirements } from 'csdm/common/types/review-clip';
import { ReviewClipService, type ResolvedReviewClip } from './review-clip-service';

const input: ResolvedReviewClip = {
  request: { checksum: 'abc123', steamId: '76561198000000001', roundNumber: 1, startTick: 1000, endTick: 2280 },
  demoPath: '/read-only/source.dem',
  mapName: 'de_inferno',
  playerName: 'Player',
  tickrate: 64,
  revision: 'revision1',
};
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
vi.stubGlobal('logger', { error: vi.fn() });
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-clips-test-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function setup() {
  const changes: ReviewClip[] = [];
  const requirements = vi.fn(() => Promise.resolve(ready));
  const resolve = vi.fn(() => Promise.resolve(input));
  const record = vi.fn(
    async (
      _input: ResolvedReviewClip,
      id: string,
      folder: string,
      _signal: AbortSignal,
      update: (status: ReviewClip['status']) => void,
    ) => {
      update('recording');
      update('encoding');
      const file = path.join(folder, 'recorded.mp4');
      await fs.writeFile(file, 'unit-test fake media; not a gameplay recording');
      return file;
    },
  );
  const dependencies = {
    directory: () => directory,
    resolve,
    requirements,
    record,
    changed: (clip: ReviewClip) => changes.push(clip),
  };
  return { service: new ReviewClipService(dependencies), dependencies, record, requirements, resolve, changes };
}

describe('on-demand review clips', () => {
  it('does not record on inspection and serves only its controlled finalized URL after success', async () => {
    const { service, record, dependencies, changes } = setup();
    expect((await service.inspect(input.request)).clip.status).toBe('missing');
    expect(record).not.toHaveBeenCalled();
    const queued = await service.generate(input.request);
    expect(queued.clip.status).toBe('queued');
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    const completed = await service.inspect(input.request);
    expect(completed.clip.status).toBe('ready');
    expect(completed.clip.videoUrl).toContain('/clip.mp4');
    expect(changes.map((clip) => clip.status)).toEqual(['queued', 'recording', 'encoding', 'ready']);
    const manifest = path.join(directory, queued.clip.id, 'manifest.json');
    const saved = JSON.parse(await fs.readFile(manifest, 'utf8'));
    saved.clip.videoUrl = 'file:///private/arbitrary-file.mp4';
    await fs.writeFile(manifest, JSON.stringify(saved));
    const restarted = new ReviewClipService(dependencies);
    expect((await restarted.inspect(input.request)).clip.videoUrl).toBe(completed.clip.videoUrl);
    await restarted.generate(input.request);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('does not start while dependencies are missing or the game is running', async () => {
    const { service, requirements, record } = setup();
    requirements.mockResolvedValue({
      ...ready,
      hlaeInstalled: false,
      gameRunning: true,
      missingReasons: ['hlae-missing', 'game-running'],
    });
    const result = await service.generate(input.request);
    expect(result.clip.status).toBe('failed');
    expect(result.clip.issue).toBe('hlae-missing');
    expect(record).not.toHaveBeenCalled();
    expect(service.isBusy()).toBe(false);
  });

  it('deduplicates simultaneous requests and reports interrupted jobs after restart', async () => {
    const { service, record, dependencies } = setup();
    let finish!: () => void;
    record.mockImplementation(async (_input, _id, folder) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      const file = path.join(folder, 'recorded.mp4');
      await fs.writeFile(file, 'test media');
      return file;
    });
    const results = await Promise.all([service.generate(input.request), service.generate(input.request)]);
    expect(results[0].clip.id).toBe(results[1].clip.id);
    expect(record).toHaveBeenCalledTimes(1);
    expect((await new ReviewClipService(dependencies).inspect(input.request)).clip.issue).toBe('interrupted');
    finish();
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  });

  it('cannot mark a missing output successful and can retry a failed clip', async () => {
    const { service, record } = setup();
    record.mockResolvedValueOnce(path.join(directory, 'does-not-exist.mp4'));
    await service.generate(input.request);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect((await service.inspect(input.request)).clip.issue).toBe('output-missing');
    await service.generate(input.request);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect((await service.inspect(input.request)).clip.status).toBe('ready');
  });

  it('keeps the busy lock until canceled recording cleanup settles and never exposes partial media', async () => {
    const { service, record } = setup();
    let finish!: () => void;
    record.mockImplementation(async (_input, _id, folder) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      const file = path.join(folder, 'partial.mp4');
      await fs.writeFile(file, 'partial');
      return file;
    });
    const { clip } = await service.generate(input.request);
    expect(service.cancel(clip.id)?.status).toBe('canceled');
    expect(service.isBusy()).toBe(true);
    finish();
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    const canceled = await service.inspect(input.request);
    expect(canceled.clip.status).toBe('canceled');
    expect(canceled.clip.videoUrl).toBeUndefined();
  });

  it('invalidates a disappeared MP4 and uses a new key when analysis revision changes', async () => {
    const { service, resolve } = setup();
    const first = await service.generate(input.request);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    await fs.unlink(path.join(directory, first.clip.id, 'clip.mp4'));
    expect((await service.inspect(input.request)).clip.issue).toBe('output-missing');
    resolve.mockResolvedValue({ ...input, revision: 'revision2' });
    const next = await service.inspect(input.request);
    expect(next.clip.id).not.toBe(first.clip.id);
    expect(next.clip.status).toBe('missing');
  });
});
