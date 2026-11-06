import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { DeathEvidenceState } from 'csdm/common/types/death-evidence';
import { deathBatchKey, deathBatchProgress, type DeathBatchItem } from './death-batch-progress';
import { DeathBatchTracker, loadDeathBatch, parseDeathBatch, saveDeathBatch } from './death-batch-storage';

const item: DeathBatchItem = {
  checksum: 'abc123',
  steamId: '76561198000000001',
  deathId: 'death:1',
  status: 'running',
  completedTicks: 30,
  totalTicks: 449,
};
function state(patch: Partial<DeathEvidenceState>): DeathEvidenceState {
  return { ...item, phase: 'decode', report: null, error: null, ...patch };
}
function stored(items: unknown[]) {
  return JSON.stringify({ version: 1, items });
}

afterEach(() => vi.unstubAllGlobals());

it('restores a bounded valid batch and removes reports, invalid IDs, duplicates and unknown state', () => {
  expect(parseDeathBatch(stored([{ ...item, report: { privateFrames: [1, 2, 3] } }, item]))).toEqual([item]);
  for (const patch of [
    { steamId: '1' },
    { checksum: '../outside' },
    { deathId: '' },
    { status: 'ready' },
    { completedTicks: -1 },
    { completedTicks: 450 },
    { totalTicks: 4.5 },
  ])
    expect(parseDeathBatch(stored([{ ...item, ...patch }]))).toEqual([]);
  const many = Array.from({ length: 40 }, (_, index) => ({ ...item, deathId: `death:${index}` }));
  expect(parseDeathBatch(stored(many))).toHaveLength(32);
  for (const data of [null, '', 'null', '{', '[]', JSON.stringify({ version: 2, items: [item] }), 'x'.repeat(65537)])
    expect(parseDeathBatch(data)).toEqual([]);
});

it('persists only compact progress and recovers when storage is unavailable', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  saveDeathBatch([state({ error: 'Private failure detail', phase: 'evaluate' })]);
  expect(loadDeathBatch()).toEqual([item]);
  const encoded = [...values.values()][0];
  expect(encoded).not.toContain('report');
  expect(encoded).not.toContain('Private');
  expect(encoded).not.toContain('phase');
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('disabled');
    },
    setItem: () => {
      throw new Error('quota');
    },
  });
  expect(loadDeathBatch()).toEqual([]);
  expect(() => saveDeathBatch([item])).not.toThrow();
});

it('hydrates a restarted server idle state as paused, preserving the keys for explicit resume', () => {
  const tracker = new DeathBatchTracker([item]);
  const token = tracker.token(deathBatchKey(item));
  expect(tracker.reply(state({ status: 'idle', completedTicks: 0, totalTicks: 0 }), token, true)).toBe(true);
  expect(tracker.snapshot()[0]).toEqual({ ...item, status: 'canceled', completedTicks: 0, totalTicks: 0 });
  expect(deathBatchProgress(tracker.snapshot())).toMatchObject({ active: false, canceled: 1, total: 1 });
});

it('restores a live job and lets a newer completion push beat the older read response', () => {
  const tracker = new DeathBatchTracker([item]);
  const token = tracker.token(deathBatchKey(item));
  tracker.push(state({ status: 'completed', completedTicks: 449 }));
  expect(tracker.reply(state({ status: 'running', completedTicks: 50 }), token, true)).toBe(false);
  expect(tracker.snapshot()[0].status).toBe('completed');
  expect(deathBatchProgress(tracker.snapshot()).active).toBe(false);
});

it('rejects replies from the previous batch even when the selected death is the same', () => {
  const tracker = new DeathBatchTracker([item]);
  const old = tracker.token(deathBatchKey(item));
  tracker.replace([{ ...item, status: 'queued', completedTicks: 0 }]);
  expect(tracker.reply(state({ status: 'error' }), old)).toBe(false);
  const fresh = tracker.token(deathBatchKey(item));
  expect(tracker.reply(state({ status: 'running', completedTicks: 1 }), fresh)).toBe(true);
  expect(tracker.snapshot()[0].completedTicks).toBe(1);
  expect(tracker.push(state({ deathId: 'unrelated' }))).toBe(false);
});
