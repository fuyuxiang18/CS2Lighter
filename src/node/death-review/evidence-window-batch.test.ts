import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { EvidenceEnd, EvidenceFrame, EvidenceHeader, EvidenceMessage, EvidenceShot } from './evidence-protocol';
import {
  extractEvidenceWindows,
  groupEvidenceWindows,
  planEvidenceScans,
  type ExtractedEvidenceWindow,
} from './evidence-window-batch';

const native = vi.hoisted(() => vi.fn());
vi.mock('./death-evidence-process', () => ({ runDeathEvidenceProcess: native }));
const windows = [
  { startTick: 10, endTick: 11 },
  { startTick: 20, endTick: 21 },
];
const header: EvidenceHeader = {
  type: 'header',
  version: 1,
  parserVersion: 'fixture',
  playerFieldsMode: 'delta',
  mapName: 'de_test',
  tickRate: 64,
  windows,
  requestedTicks: 4,
  patch: null,
  buildNum: null,
  sourceBytes: 100,
};
const entity = { id: '10:2', className: 'CBasePropDoor', origin: null, fields: {} };
function frame(tick: number, complete = false): EvidenceFrame {
  return {
    type: 'frame',
    frame: tick + 100,
    tick,
    serverTick: tick + 200,
    players: [],
    world: { complete, upserts: complete ? [entity] : [], removed: [] },
    smokes: { complete, upserts: [], removed: [] },
  };
}
function shot(tick: number): EvidenceShot {
  return {
    type: 'shot',
    frame: tick + 100,
    tick,
    serverTick: tick + 200,
    playerHandle: null,
    playerSlot: null,
    playerEntityId: null,
    steamId: null,
    raw: {},
  };
}
const end: EvidenceEnd = {
  type: 'end',
  status: 'ok',
  emittedTicks: 3,
  missingTicks: [21],
  duplicateTicks: 0,
  frames: 3,
  shots: 2,
  capabilities: ['environment-model-candidates'],
  supportedClasses: { CBasePropDoor: 1 },
  unsupportedClasses: { CFutureWall: 1 },
  windowClasses: windows.map((window) => ({
    startTick: window.startTick,
    endTick: window.endTick,
    supportedClasses: { CBasePropDoor: 1 },
    unsupportedClasses: window.endTick === 21 ? { CFutureWall: 1 } : ({} as Record<string, number>),
    duplicateTicks: 0,
  })),
};
let directory: string;
let messages: EvidenceMessage[];
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'cs2lighter-batch-test-'));
  messages = [header, frame(10, true), shot(11), frame(11), shot(20), frame(20), end];
  native.mockReset();
  native.mockImplementation(async ({ onMessage }: { onMessage: (message: EvidenceMessage) => Promise<void> }) => {
    for (const message of messages) await onMessage(structuredClone(message));
    return end;
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function extract(overrides: Partial<Parameters<typeof extractEvidenceWindows>[0]> = {}) {
  const results: ExtractedEvidenceWindow[] = [];
  const progress: [number, number][] = [];
  await extractEvidenceWindows({
    executable: 'fixture.exe',
    demoPath: path.join(directory, 'fixture.dem'),
    directory,
    windows,
    signal: new AbortController().signal,
    onProgress: (window, count) => {
      progress.push([window.endTick, count]);
    },
    consume: (window) => {
      results.push(window);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { results, progress };
}

describe('bounded multi-window evidence extraction', () => {
  it('uses one native scan and restores the environment baseline and actual coverage for each window', async () => {
    const { results, progress } = await extract();
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][0].request.windows).toEqual(windows);
    expect(results.map((result) => result.frames.map((item) => item.tick))).toEqual([[10, 11], [20]]);
    expect(results.map((result) => result.rawShots.map((item) => item.tick))).toEqual([[11], [20]]);
    expect(results[1].frames[0].world).toEqual({ complete: true, upserts: [entity], removed: [] });
    expect(results.map((result) => result.end.missingTicks)).toEqual([[], [21]]);
    expect(results.map((result) => result.end.unsupportedClasses)).toEqual([{}, { CFutureWall: 1 }]);
    expect(results.map((result) => result.header.requestedTicks)).toEqual([2, 2]);
    expect(progress.slice(-2)).toEqual([
      [11, 2],
      [21, 1],
    ]);
    expect(await readdir(directory)).toEqual([]);
  });

  it('handles overlapping windows and fire events emitted ahead of the previous frame flush', async () => {
    const overlapping = [
      { startTick: 10, endTick: 20 },
      { startTick: 11, endTick: 20 },
    ];
    messages = [header, shot(11), frame(10, true), shot(20), frame(11), frame(20), end];
    const localEnd = {
      ...end,
      windowClasses: overlapping.map((window) => ({
        ...window,
        supportedClasses: {},
        unsupportedClasses: {},
        duplicateTicks: 0,
      })),
    };
    native.mockImplementation(async ({ onMessage }) => {
      for (const message of messages) await onMessage(message);
      return localEnd;
    });
    const { results } = await extract({ windows: overlapping });
    expect(results.map((result) => result.rawShots.map((item) => item.tick))).toEqual([
      [11, 20],
      [11, 20],
    ]);
    expect(results[1].frames[0].world.upserts).toEqual([entity]);
    expect(await readdir(directory)).toEqual([]);
  });

  it('rehydrates player and active-weapon deltas without losing unchanged fields', async () => {
    const value = (number: number) => ({ present: true, value: number, lastUpdate: null });
    const player = {
      steamId: null,
      origin: null,
      eyes: null,
      yaw: null,
      pitch: null,
      velocity: null,
      team: null,
      health: null,
      lifeState: null,
      hull: { mins: null, maxs: null },
    };
    const first = frame(10, true);
    first.players = [
      {
        ...player,
        id: '8:1',
        fieldsComplete: true,
        fields: { health: value(100), armor: value(50) },
        activeWeapon: {
          id: '12:1',
          className: 'CAK47',
          fieldsComplete: true,
          fields: { ammo: value(30), recoil: value(0) },
        },
      },
    ];
    const second = frame(11);
    second.players = [
      {
        ...player,
        id: '8:1',
        fieldsComplete: false,
        fields: { health: value(90) },
        activeWeapon: { id: '12:1', className: 'CAK47', fieldsComplete: false, fields: { ammo: value(29) } },
      },
    ];
    messages = [header, first, second, frame(20), end];
    const { results } = await extract();
    expect(native.mock.calls[0][0].frameFields).toBe('delta');
    expect(results[0].frames[1].players[0]).toMatchObject({
      fieldsComplete: true,
      fields: { health: value(90), armor: value(50) },
      activeWeapon: { fieldsComplete: true, fields: { ammo: value(29), recoil: value(0) } },
    });
  });

  it('keeps single-window requests on the direct path without temporary spool creation', async () => {
    const { results } = await extract({ windows: [windows[0]] });
    expect(results).toHaveLength(1);
    expect(native.mock.calls[0][0].frameFields).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it('spools larger batches as deltas and removes their temporary data after reading', async () => {
    const large = [
      { startTick: 10, endTick: 1020 },
      { startTick: 2000, endTick: 2014 },
    ];
    const missingTicks = large
      .flatMap((window) =>
        Array.from({ length: window.endTick - window.startTick + 1 }, (_, index) => window.startTick + index),
      )
      .filter((tick) => ![10, 11, 2000].includes(tick));
    const localEnd = {
      ...end,
      missingTicks,
      shots: 0,
      windowClasses: large.map((window) => ({
        ...window,
        supportedClasses: {},
        unsupportedClasses: {},
        duplicateTicks: 0,
      })),
    };
    native.mockImplementation(async ({ onMessage }) => {
      for (const message of [header, frame(10, true), frame(11), frame(2000), localEnd]) await onMessage(message);
      return localEnd;
    });
    const { results } = await extract({ windows: large });
    expect(native.mock.calls[0][0].frameFields).toBe('delta');
    expect(results.map((result) => result.frames.length)).toEqual([2, 1]);
    expect(results[1].frames[0].world.upserts).toEqual([entity]);
    expect(await readdir(directory)).toEqual([]);
  });

  it('splits a dense batch on the wire limit instead of failing deaths that fit separately', async () => {
    native.mockImplementation(async ({ request, onMessage }) => {
      if (request.windows.length > 1) throw new Error('evidence output exceeds 128 MiB');
      const window = request.windows[0];
      await onMessage({ ...header, windows: [window], requestedTicks: 2 });
      await onMessage(frame(window.startTick, true));
      return { ...end, emittedTicks: 1, frames: 1, missingTicks: [window.endTick], shots: 0 };
    });
    const { results } = await extract();
    expect(native).toHaveBeenCalledTimes(3);
    expect(results.map((result) => result.window)).toEqual(windows);
    expect(await readdir(directory)).toEqual([]);
  });

  it('never evaluates partial output and removes temporary files on native failure', async () => {
    native.mockImplementation(async ({ onMessage }) => {
      await onMessage(header);
      await onMessage(frame(10, true));
      throw new Error('native failure');
    });
    const consume = vi.fn();
    await expect(extract({ consume })).rejects.toThrow('native failure');
    expect(consume).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('removes the spool after evaluation failure and cancellation', async () => {
    await expect(extract({ consume: () => Promise.reject(new Error('evaluate failed')) })).rejects.toThrow(
      'evaluate failed',
    );
    expect(await readdir(directory)).toEqual([]);
    const controller = new AbortController();
    await expect(
      extract({
        signal: controller.signal,
        consume: () => {
          controller.abort();
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses cross-window conclusions from a native binary without window class coverage', async () => {
    native.mockImplementation(async ({ onMessage }) => {
      for (const message of messages) await onMessage(message);
      return { ...end, windowClasses: undefined };
    });
    await expect(extract()).rejects.toThrow('per-window class coverage');
    expect(await readdir(directory)).toEqual([]);
  });

  it('splits requests on the native tick budget and counts shared ticks only once', () => {
    expect(
      groupEvidenceWindows([
        { startTick: 1000, endTick: 4000 },
        { startTick: 0, endTick: 3000 },
      ]),
    ).toHaveLength(1);
    const groups = groupEvidenceWindows([
      { startTick: 0, endTick: 3000 },
      { startTick: 4000, endTick: 6000 },
    ]);
    expect(groups.map((group) => group.length)).toEqual([1, 1]);
    expect(() => groupEvidenceWindows([{ startTick: 0, endTick: 4096 }])).toThrow('Invalid');
  });

  it('keeps short prefixes direct and coalesces expensive late-demo rescans', () => {
    expect(
      planEvidenceScans([
        { startTick: 2386, endTick: 2834 },
        { startTick: 2914, endTick: 3362 },
      ]),
    ).toHaveLength(2);
    expect(
      planEvidenceScans([
        { startTick: 60000, endTick: 60448 },
        { startTick: 120000, endTick: 120448 },
        { startTick: 180000, endTick: 180448 },
      ]),
    ).toHaveLength(1);
  });
});
