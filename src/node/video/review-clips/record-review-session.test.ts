import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test';
import { watchDemoWithHlae } from 'csdm/node/counter-strike/launcher/watch-demo-with-hlae';
import { isCounterStrikeRunning } from 'csdm/node/counter-strike/is-counter-strike-running';
import { generateVideoWithFFmpeg } from 'csdm/node/video/generation/generate-video-with-ffmpeg';
import { getSequenceOutputFilePath } from 'csdm/node/video/generation/get-sequence-output-file-path';
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
  vi.mocked(generateVideoWithFFmpeg).mockResolvedValue(undefined);
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

it('prepares two demos, launches once and drains encoded events before the session settles', async () => {
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
  expect(nextReviewSessionCommand('a.dem', { demoPath: 'a.dem', xmlPath: 'two.xml', entryTick: 1743 })).toBe(
    'mirv_cmd load "two.xml"; demo_gototick 1743; demo_resume',
  );
  expect(() => nextReviewSessionCommand('a.dem', { demoPath: 'a.dem', xmlPath: 'two.xml', entryTick: NaN })).toThrow();
});

function twoEncounters() {
  const first = groups[0][0];
  first.item.segments.push({ ...first.item.segments[0], index: 2, perspective: 'opponent' });
  const second = structuredClone(first);
  second.item.index = 2;
  second.item.segments = second.item.segments.map((segment, index) => ({
    ...segment,
    index: index + 3,
    startTick: 2000,
    endTick: 2200,
  }));
  groups = [[first, second]];
}

it('captures forward passes and keeps each encounter player/opponent montage order intact', async () => {
  twoEncounters();
  const captured: number[] = [];
  const encoded: number[] = [];
  const committed: number[][] = [];
  vi.mocked(generateVideoWithFFmpeg).mockImplementation((settings) => {
    encoded.push(settings.sequence.number);
    return Promise.resolve();
  });
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    for (const index of [1, 3, 2, 4]) {
      captured.push(index);
      const command = await bridge.completed!(index);
      if (index === 1 || index === 2) {
        expect(command).toContain('demo_gototick 1743');
        expect(command).not.toContain('demo_gototick 0;');
        const nextIndex = index === 1 ? 3 : 4;
        const xml = await fs.readFile(path.join(directory, 'demo-1', `segment-${nextIndex}.xml`), 'utf8');
        expect(xml).toContain('<c tick="1744">demo_ui_mode 0</c>');
        expect(xml).toContain('<c tick="1744">sv_cheats 1</c>');
        expect(xml).not.toContain('<c tick="96">');
        expect(xml).not.toContain('demo_gototick');
        expect(xml).toContain('<c tick="1936">spec_player 3</c>');
        expect(xml).toContain('<c tick="2000">mirv_streams record start</c>');
        expect(xml).toContain('<c tick="2200">mirv_streams record end</c>');
      } else if (index === 3) expect(command).toContain('demo_gototick 0');
      else expect(command).toBe('quit');
    }
  });
  await recordReviewSession(
    groups,
    directory,
    new AbortController().signal,
    vi.fn(),
    vi.fn(),
    ({ item }) => {
      committed.push(item.segments.map((segment) => segment.index));
      return Promise.resolve();
    },
    () => false,
  );
  expect(captured).toEqual([1, 3, 2, 4]);
  expect(encoded).toEqual([1, 3, 2, 4]);
  expect(committed).toEqual([
    [1, 2],
    [3, 4],
  ]);
});

it('overlaps capture and one encoder with two-segment back-pressure, then drains before cleanup', async () => {
  const gate = Promise.withResolvers<void>();
  const finishing = Promise.withResolvers<void>();
  let secondBoundarySettled = false;
  let encodingCalls = 0;
  const committed = vi.fn(async () => {});
  vi.mocked(generateVideoWithFFmpeg).mockImplementation(async () => {
    encodingCalls++;
    if (encodingCalls === 1) await gate.promise;
    else await finishing.promise;
  });
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    expect(await bridge.completed!(1)).toContain('playdemo');
    expect(committed).not.toHaveBeenCalled();
    const second = bridge.completed!(2).then((command) => {
      secondBoundarySettled = true;
      return command;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondBoundarySettled).toBe(false);
    expect(encodingCalls).toBe(1);
    gate.resolve();
    expect(await second).toBe('quit');
  });
  let sessionSettled = false;
  const session = recordReviewSession(
    groups,
    directory,
    new AbortController().signal,
    vi.fn(),
    vi.fn(),
    committed,
    () => false,
  ).then(() => {
    sessionSettled = true;
  });
  await vi.waitFor(() => expect(encodingCalls).toBe(2));
  expect(sessionSettled).toBe(false);
  finishing.resolve();
  await session;
  expect(committed).toHaveBeenCalledTimes(2);
});

it('pauses by finishing started encounters without starting another encounter', async () => {
  twoEncounters();
  let pause = false;
  const committed = vi.fn<(item: ResolvedBatchItem) => Promise<void>>().mockResolvedValue(undefined);
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    pause = true;
    expect(await bridge.completed!(1)).toContain('segment-2.xml');
    expect(await bridge.completed!(2)).toBe('quit');
  });
  await recordReviewSession(groups, directory, new AbortController().signal, vi.fn(), vi.fn(), committed, () => pause);
  expect(generateVideoWithFFmpeg).toHaveBeenCalledTimes(2);
  expect(committed).toHaveBeenCalledTimes(1);
  expect(committed.mock.calls[0][0].item.index).toBe(1);
});

it('marks an encoding failure per event and continues recording other demos', async () => {
  vi.mocked(generateVideoWithFFmpeg).mockRejectedValueOnce(new Error('Synthetic broken media'));
  const committed: ResolvedBatchItem[] = [];
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    expect(await bridge.completed!(1)).toContain('playdemo');
    expect(await bridge.completed!(2)).toBe('quit');
  });
  await recordReviewSession(
    groups,
    directory,
    new AbortController().signal,
    vi.fn(),
    vi.fn(),
    (item) => {
      committed.push(item);
      return Promise.resolve();
    },
    () => false,
  );
  expect(committed.map(({ item }) => [item.index, item.status, item.issue])).toEqual([
    [1, 'failed', 'recording-failed'],
    [2, 'queued', undefined],
  ]);
});

it('cancels and drains the active encoder before returning control for staging cleanup', async () => {
  const abort = new AbortController();
  let encoderDrained = false;
  vi.mocked(generateVideoWithFFmpeg).mockImplementation(async (_settings, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    encoderDrained = true;
    signal.throwIfAborted();
  });
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    await bridge.completed!(1);
    abort.abort();
    throw new Error('Synthetic canceled game');
  });
  await expect(
    recordReviewSession(groups, directory, abort.signal, vi.fn(), vi.fn(), vi.fn(), () => false),
  ).rejects.toThrow();
  expect(encoderDrained).toBe(true);
  expect(bridge.close).toHaveBeenCalledTimes(1);
});

it('removes only successfully muxed raw capture folders and preserves inputs and edited sequence media', async () => {
  groups = [groups[0]];
  vi.mocked(generateVideoWithFFmpeg).mockImplementation(async (settings) => {
    const rawFolder = path.join(settings.outputFolderPath, `${settings.sequence.number}-sequence`);
    await fs.mkdir(rawFolder, { recursive: true });
    await fs.writeFile(path.join(rawFolder, 'video.mp4'), 'SYNTHETIC RAW');
    await fs.writeFile(
      getSequenceOutputFilePath(settings.outputFolderPath, settings.sequence, settings.videoContainer),
      'SYNTHETIC MUXED',
    );
  });
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    options.onGameStart?.();
    expect(await bridge.completed!(1)).toBe('quit');
  });
  await recordReviewSession(groups, directory, new AbortController().signal, vi.fn(), vi.fn(), vi.fn(), () => false);
  expect(await fs.stat(path.join(directory, 'demo-1', '1-sequence')).catch(() => undefined)).toBeUndefined();
  expect(await fs.readFile(path.join(directory, 'demo-1', 'sequence-1-tick-500-to-700.mp4'), 'utf8')).toBe(
    'SYNTHETIC MUXED',
  );
  expect(await fs.readFile(groups[0][0].input.demoPath, 'utf8')).toBe('SYNTHETIC DEMO');
});

it('does not seek past camera setup for clips near the beginning of a demo', async () => {
  groups = [groups[0]];
  groups[0][0].item.segments[0].startTick = 120;
  vi.mocked(watchDemoWithHlae).mockImplementation(async (options) => {
    const xml = await fs.readFile(options.nativeCommandsPath!, 'utf8');
    expect(xml).not.toContain('demo_gototick');
    expect(xml).toContain('<c tick="96">spec_player 3</c>');
    expect(xml).toContain('<c tick="120">mirv_streams record start</c>');
    options.onGameStart?.();
    expect(await bridge.completed!(1)).toBe('quit');
  });
  await recordReviewSession(groups, directory, new AbortController().signal, vi.fn(), vi.fn(), vi.fn(), () => false);
});
