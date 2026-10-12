import { describe, expect, it } from 'vite-plus/test';
import path from 'node:path';
import type { EvidenceMessage, EvidenceRequest } from './evidence-protocol';
import { runDeathEvidenceProcess, validateEvidenceRequest } from './death-evidence-process';

const request: EvidenceRequest = {
  version: 1,
  demoPath: path.resolve('test-fixture.dem'),
  windows: [{ startTick: 10, endTick: 11 }],
};
const header = {
  type: 'header',
  version: 1,
  parserVersion: 'test',
  playerFieldsMode: 'delta',
  mapName: 'de_test',
  tickRate: 64,
  windows: request.windows,
  requestedTicks: 2,
};
const frame = {
  type: 'frame',
  frame: 1,
  tick: 10,
  serverTick: 100,
  players: [],
  world: { complete: true, upserts: [], removed: [] },
  smokes: { complete: true, upserts: [], removed: [] },
};
const end = {
  type: 'end',
  status: 'ok',
  emittedTicks: 1,
  missingTicks: [11],
  duplicateTicks: 0,
  frames: 1,
  shots: 0,
};

function script(messages: unknown[], suffix = '') {
  return `process.stdin.resume(); process.stdin.on('end', () => { ${messages.map((message) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(message)}\n`)});`).join('\n')} ${suffix} });`;
}

function run(source: string, signal = new AbortController().signal, timeoutMs = 5000) {
  const messages: EvidenceMessage[] = [];
  const result = runDeathEvidenceProcess({
    executable: process.execPath,
    args: ['-e', source],
    request,
    signal,
    timeoutMs,
    onMessage: (message) => {
      messages.push(message);
    },
  });
  return { result, messages };
}

describe('bounded death evidence subprocess', () => {
  it('preserves missing ticks instead of treating them as empty world snapshots', async () => {
    const job = run(script([header, frame, end]));
    await expect(job.result).resolves.toMatchObject({ missingTicks: [11], emittedTicks: 1 });
    expect(job.messages.map((message) => message.type)).toEqual(['header', 'frame', 'end']);
  });

  it('does not accept a successful exit that omitted its final coverage report', async () => {
    await expect(run(script([header, frame])).result).rejects.toThrow('did not finish');
  });

  it('rejects an apparently complete report that did not emit its promised frame', async () => {
    await expect(run(script([header, { ...end, emittedTicks: 2, missingTicks: [] }])).result).rejects.toThrow(
      'coverage',
    );
  });

  it('rejects frames outside the requested death windows', async () => {
    await expect(run(script([header, { ...frame, tick: 12 }, end])).result).rejects.toThrow('escaped');
  });

  it('does not accept a trailing frame after the end marker', async () => {
    await expect(run(script([header, frame, end, frame])).result).rejects.toThrow('after its final');
  });

  it('bounds one unterminated line and kills the decoder when exceeded', async () => {
    await expect(
      run(script([header], `process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));`)).result,
    ).rejects.toThrow('size limit');
  });

  it('reconstructs player fields and requires a new baseline after a time gap', async () => {
    const baseline = {
      id: '8:1',
      fieldsComplete: true,
      fields: { x: { present: true, value: 10, lastUpdate: null } },
    };
    const delta = {
      id: '8:1',
      fieldsComplete: false,
      fields: { y: { present: true, value: 20, lastUpdate: null } },
    };
    const job = run(
      script([
        header,
        { ...frame, players: [baseline] },
        { ...frame, tick: 11, players: [delta] },
        { ...end, emittedTicks: 2, missingTicks: [] },
      ]),
    );
    await job.result;
    const frames = job.messages.filter((message) => message.type === 'frame');
    expect(frames[1].players[0].fields).toEqual({ ...baseline.fields, ...delta.fields });
    expect(frames[0].players[0].fields).toEqual(baseline.fields);
    await expect(run(script([header, { ...frame, players: [delta] }, end])).result).rejects.toThrow('no baseline');
    const messages = [
      {
        ...header,
        windows: [
          { startTick: 10, endTick: 10 },
          { startTick: 12, endTick: 12 },
        ],
      },
      { ...frame, players: [baseline] },
      { ...frame, tick: 12, players: [delta] },
      { ...end, emittedTicks: 2, missingTicks: [] },
    ];
    await expect(
      runDeathEvidenceProcess({
        executable: process.execPath,
        args: ['-e', script(messages)],
        request: {
          ...request,
          windows: [
            { startTick: 10, endTick: 10 },
            { startTick: 12, endTick: 12 },
          ],
        },
        signal: new AbortController().signal,
        onMessage: () => {},
      }),
    ).rejects.toThrow('no baseline');
  });

  it('cancels a process even while the decoder has not produced any output', async () => {
    const controller = new AbortController();
    const job = run('setInterval(() => {}, 1000)', controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(job.result).rejects.toThrow();
  });

  it('reconstructs weapon deltas without mutating the earlier snapshot', async () => {
    const ammo = { present: true, value: 30, lastUpdate: null };
    const reload = { present: true, value: false, lastUpdate: null };
    const player = { id: '8:1', fieldsComplete: true, fields: {} };
    const weapon = {
      id: '300:5',
      className: 'CAK47',
      fieldsComplete: true,
      fields: { ammo, reload },
    };
    const changedAmmo = { ...ammo, value: 29 };
    const job = run(
      script([
        header,
        { ...frame, players: [{ ...player, activeWeapon: weapon }] },
        {
          ...frame,
          tick: 11,
          players: [
            {
              ...player,
              activeWeapon: { ...weapon, fieldsComplete: false, fields: { ammo: changedAmmo } },
            },
          ],
        },
        { ...end, emittedTicks: 2, missingTicks: [] },
      ]),
    );
    await job.result;
    const frames = job.messages.filter((message) => message.type === 'frame');
    expect(frames[0].players[0].activeWeapon?.fields).toEqual({ ammo, reload });
    expect(frames[1].players[0].activeWeapon?.fields).toEqual({ ammo: changedAmmo, reload });
    expect(frames[1].players[0].activeWeapon?.fieldsComplete).toBe(true);
  });

  it('requires a full weapon baseline for a new weapon or reused entity index', async () => {
    const player = { id: '8:1', fieldsComplete: true, fields: {} };
    const weapon = { id: '300:5', className: 'CAK47', fieldsComplete: true, fields: {} };
    for (const previousWeapon of [null, weapon]) {
      await expect(
        run(
          script([
            header,
            { ...frame, players: [{ ...player, activeWeapon: previousWeapon }] },
            {
              ...frame,
              tick: 11,
              players: [{ ...player, activeWeapon: { ...weapon, id: '300:6', fieldsComplete: false } }],
            },
            { ...end, emittedTicks: 2, missingTicks: [] },
          ]),
        ).result,
      ).rejects.toThrow('weapon delta has no baseline');
    }
  });

  it('does not carry the prior weapon fields into a replacement weapon', async () => {
    const player = { id: '8:1', fieldsComplete: true, fields: {} };
    const weapon = {
      id: '300:5',
      className: 'CAK47',
      fieldsComplete: true,
      fields: { old: { present: true, value: 1, lastUpdate: null } },
    };
    const next = {
      ...weapon,
      id: '300:6',
      fields: { current: { present: true, value: 2, lastUpdate: null } },
    };
    const job = run(
      script([
        header,
        { ...frame, players: [{ ...player, activeWeapon: weapon }] },
        { ...frame, tick: 11, players: [{ ...player, activeWeapon: next }] },
        { ...end, emittedTicks: 2, missingTicks: [] },
      ]),
    );
    await job.result;
    const frames = job.messages.filter((message) => message.type === 'frame');
    expect(frames[1].players[0].activeWeapon?.fields).toEqual(next.fields);
  });

  it('times out a stalled decoder and reports the failure', async () => {
    await expect(run('setInterval(() => {}, 1000)', undefined, 50).result).rejects.toThrow('timed out');
  });

  it('rejects spawn failures without hanging', async () => {
    await expect(
      runDeathEvidenceProcess({
        executable: path.resolve('this-parser-does-not-exist.exe'),
        request,
        signal: new AbortController().signal,
        onMessage: () => {},
      }),
    ).rejects.toThrow();
  });
});

describe('death evidence request limits', () => {
  it('merges overlapping windows when checking the budget', () => {
    expect(validateEvidenceRequest({ ...request, windows: [...request.windows, ...request.windows] }).size).toBe(2);
  });

  it('rejects too many ticks, relative paths and non-demo inputs', () => {
    for (const invalid of [
      { ...request, windows: [{ startTick: 0, endTick: 4096 }] },
      {
        ...request,
        windows: [
          { startTick: 0, endTick: 2048 },
          { startTick: 9000, endTick: 11048 },
        ],
      },
      { ...request, demoPath: 'relative.dem' },
      { ...request, demoPath: path.resolve('unexpected.txt') },
      { ...request, windows: [{ startTick: NaN, endTick: 1 }] },
      { ...request, players: ['someone'] },
    ])
      expect(() => validateEvidenceRequest(invalid)).toThrow();
  });
});
