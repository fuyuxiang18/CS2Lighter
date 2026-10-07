import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import { watchDemoWithHlae } from 'csdm/node/counter-strike/launcher/watch-demo-with-hlae';
import { isCounterStrikeRunning } from 'csdm/node/counter-strike/is-counter-strike-running';
import { generateVideoWithFFmpeg } from 'csdm/node/video/generation/generate-video-with-ffmpeg';
import { recordReviewSession, nextReviewSessionCommand } from './record-review-session';
import type { ResolvedBatchItem } from './resolve-review-batch';

const bridge = vi.hoisted(() => ({
  completed: undefined as ((segment: number) => Promise<string>) | undefined,
  close: vi.fn(async () => {}),
}));
vi.mock('csdm/node/demo/get-demo-checksum-from-demo-path', () => ({
  getDemoChecksumFromDemoPath: (file: string) => Promise.resolve(file.endsWith('a.dem') ? 'a' : 'b'),
}));
vi.mock('csdm/node/counter-strike/get-csgo-folder-path', () => ({
  getCsgoFolderPathOrThrow: () => Promise.resolve('/synthetic/game'),
}));
vi.mock('csdm/node/counter-strike/is-counter-strike-running', () => ({
  isCounterStrikeRunning: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('csdm/node/counter-strike/launcher/watch-demo-with-hlae', () => ({ watchDemoWithHlae: vi.fn() }));
vi.mock('csdm/node/video/generation/generate-video-with-ffmpeg', () => ({
  generateVideoWithFFmpeg: vi.fn(async () => {}),
}));
vi.mock('csdm/node/video/ffmpeg/ffmpeg-location', () => ({
  getFfmpegExecutablePath: () => Promise.resolve('/synthetic/ffmpeg.exe'),
}));
vi.mock('csdm/server/update-maintenance', () => ({ isUpdateMaintenance: () => false }));
vi.mock('./assert-review-game-files', () => ({ assertReviewGameFiles: async () => {} }));
vi.mock('./review-session-bridge', () => ({
  createReviewSessionBridge: (options: { completed: (segment: number) => Promise<string> }) => {
    bridge.completed = options.completed;
    return Promise.resolve({ url: 'ws://127.0.0.1:1234/synthetic-token', close: bridge.close });
  },
  buildReviewBoundaryScript: () => '// synthetic boundary transport',
}));
vi.stubGlobal('logger', { debug: vi.fn(), error: vi.fn() });
let directory: string;
let groups: ResolvedBatchItem[][];
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(isCounterStrikeRunning).mockResolvedValue(false);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'record-session-'));
  groups = await Promise.all(
    ['a', 'b'].map(async (checksum, index) => {
      const source = path.join(directory, `${checksum}.dem`);
      await fs.writeFile(source, 'SYNTHETIC DEMO');
      const request = { checksum, steamId: '76561198000000001', roundNumber: 1, startTick: 500, endTick: 700 };
      return [
        {
          input: {
            request,
            demoPath: source,
            mapName: 'de_test',
            playerName: 'Synthetic player',
            tickrate: 64,
            revision: '1',
          },
          slots: { '76561198000000001': 3 },
          item: {
            index: index + 1,
            request,
            mapName: 'de_test',
            tickrate: 64,
            status: 'queued' as const,
            opponentUnavailable: false,
            segments: [
              {
                index: index + 1,
                perspective: 'player' as const,
                steamId: request.steamId,
                playerName: 'Synthetic player',
                startTick: request.startTick,
                endTick: request.endTick,
                truncatedAtDeath: false,
                status: 'queued' as const,
              },
            ],
          },
        },
      ];
    }),
  );
});
afterEach(async () => {
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe test cleanup');
  await fs.rm(directory, { recursive: true, force: true });
});

it('prepares two demos, launches once and awaits each committed event before commanding a cross-demo load', async () => {
  const commands: string[] = [];
  const committed: number[] = [];
  const launched = vi.fn();
  const progress = vi.fn();
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    expect(options.refuseRunningGame).toBe(true);
    expect(options.nativeCommandsPath).toContain('segment-1.xml');
    expect(options.configFolderPath).toContain('game-config');
    options.onGameStart?.();
    commands.push(await bridge.completed!(1));
    expect(committed).toEqual([1]);
    commands.push(await bridge.completed!(2));
  });
  await recordReviewSession(
    groups,
    directory,
    new AbortController().signal,
    progress,
    launched,
    (item) => {
      committed.push(item.item.index);
      return Promise.resolve();
    },
    () => false,
  );
  expect(watchDemoWithHlae).toHaveBeenCalledTimes(1);
  expect(launched).toHaveBeenCalledTimes(1);
  expect(commands[0]).toContain('playdemo');
  expect(commands[0]).toContain('demo-2/source.dem');
  expect(commands[1]).toBe('quit');
  expect(committed).toEqual([1, 2]);
  expect(generateVideoWithFFmpeg).toHaveBeenCalledTimes(2);
  const xml = await fs.readFile(path.join(directory, 'demo-2', 'segment-2.xml'), 'utf8');
  expect(xml).toContain('mirv_script_spec_lock 3');
  expect(xml).toContain('demo_gototick 244');
  expect(xml).toContain('<c tick="500">mirv_streams record start</c>');
  expect(xml).toContain('<c tick="700">mirv_streams record end</c>');
  expect(xml).toContain('boundary-2.js');
  expect(xml).not.toContain('>quit<');
  expect(await fs.readFile(groups[0][0].input.demoPath, 'utf8')).toBe('SYNTHETIC DEMO');
  expect(bridge.close).toHaveBeenCalledTimes(1);
});
it('pauses after the current complete encounter and never loads the next demo', async () => {
  let pause = false;
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    pause = true;
    expect(await bridge.completed!(1)).toBe('quit');
  });
  const committed = vi.fn(async () => {});
  await recordReviewSession(groups, directory, new AbortController().signal, vi.fn(), vi.fn(), committed, () => pause);
  expect(committed).toHaveBeenCalledTimes(1);
  expect(generateVideoWithFFmpeg).toHaveBeenCalledTimes(1);
});
it('reports a missing source as a failed item and still records the other demo in the single session', async () => {
  await fs.unlink(groups[0][0].input.demoPath);
  const results: ResolvedBatchItem[] = [];
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    expect(options.demoPath).toContain('demo-2');
    options.onGameStart?.();
    expect(await bridge.completed!(2)).toBe('quit');
  });
  await recordReviewSession(
    groups,
    directory,
    new AbortController().signal,
    vi.fn(),
    vi.fn(),
    (item) => {
      results.push(item);
      return Promise.resolve();
    },
    () => false,
  );
  expect(results.map((item) => [item.item.index, item.item.issue])).toEqual([
    [1, 'demo-missing'],
    [2, undefined],
  ]);
  expect(watchDemoWithHlae).toHaveBeenCalledTimes(1);
});
it('refuses an existing game before staging or launch and never calls a global process kill', async () => {
  vi.mocked(isCounterStrikeRunning).mockResolvedValue(true);
  await expect(
    recordReviewSession(groups, directory, new AbortController().signal, vi.fn(), vi.fn(), vi.fn(), () => false),
  ).rejects.toMatchObject({ issue: 'game-running' });
  expect(watchDemoWithHlae).not.toHaveBeenCalled();
  expect(await fs.stat(path.join(directory, 'demo-1')).catch(() => undefined)).toBeUndefined();
});
it('forwards cancellation through the owned launcher signal and closes the private bridge', async () => {
  const abort = new AbortController();
  let owned: AbortSignal | undefined;
  vi.mocked(watchDemoWithHlae).mockImplementation((options) => {
    owned = options.signal;
    abort.abort();
    return Promise.reject(new Error('aborted'));
  });
  await expect(
    recordReviewSession(groups, directory, abort.signal, vi.fn(), vi.fn(), vi.fn(), () => false),
  ).rejects.toThrow();
  expect(owned?.aborted).toBe(true);
  expect(bridge.close).toHaveBeenCalledTimes(1);
  expect(generateVideoWithFFmpeg).not.toHaveBeenCalled();
});
it('rewinds within one demo and rejects command delimiters in staged paths', () => {
  expect(nextReviewSessionCommand('a.dem', { demoPath: 'a.dem', xmlPath: 'two.xml' })).toBe(
    'mirv_cmd load "two.xml"; demo_gototick 0; demo_resume',
  );
  expect(() => nextReviewSessionCommand('a.dem', { demoPath: 'bad;quit.dem', xmlPath: 'two.xml' })).toThrow();
});
