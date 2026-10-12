import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vite-plus/test';
import { DemoSource, GameMode } from 'csdm/common/types/counter-strike';
import { readDeathReviewCache, writeDeathReviewCache, type DeathMatchDescriptor } from './death-review-cache';

let directory: string;
const match: DeathMatchDescriptor = {
  checksum: 'abcdef',
  name: 'Synthetic demo',
  analyzeDate: '2026-10-12T00:00:00.000Z',
  mapName: 'de_dust2',
  date: '2026-10-11T00:00:00.000Z',
  source: DemoSource.Valve,
  tickrate: 64,
  networkProtocol: 14089,
  gameMode: GameMode.Competitive,
  shotCount: 0,
};
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2lighter-death-cache-'));
});
afterEach(async () => {
  if (
    path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
    !path.basename(directory).startsWith('cs2lighter-death-cache-')
  )
    throw new Error('Unsafe synthetic cache cleanup');
  await fs.rm(directory, { recursive: true, force: true });
});

it('preserves a valid empty all-player file, validates revisions and detects modified contents even after memory reuse', async () => {
  expect(await readDeathReviewCache(directory, match)).toBeUndefined();
  await writeDeathReviewCache(directory, match, [], new AbortController().signal);
  const first = await readDeathReviewCache(directory, match);
  expect(first).toEqual([]);
  expect(await readDeathReviewCache(directory, match)).toBe(first);
  expect(await readDeathReviewCache(directory, { ...match, analyzeDate: '2026-10-13T00:00:00.000Z' })).toBeUndefined();
  expect(await readDeathReviewCache(directory, { ...match, source: DemoSource.FaceIt })).toBeUndefined();
  const file = path.join(directory, `${match.checksum}.json`);
  const cache = JSON.parse(await fs.readFile(file, 'utf8'));
  cache.generatedAt = 'tampered';
  await fs.writeFile(file, JSON.stringify(cache));
  expect(await readDeathReviewCache(directory, match)).toBeUndefined();
});

it('rejects invalid JSON and excessive cache size before parsing', async () => {
  const file = path.join(directory, `${match.checksum}.json`);
  await fs.writeFile(file, '{broken');
  expect(await readDeathReviewCache(directory, match)).toBeUndefined();
  await fs.truncate(file, 32 * 1024 ** 2 + 1);
  expect(await readDeathReviewCache(directory, match)).toBeUndefined();
});

it('keeps the previous valid file on cancellation and disallows path traversal', async () => {
  await writeDeathReviewCache(directory, match, [], new AbortController().signal);
  const file = path.join(directory, `${match.checksum}.json`);
  const before = await fs.readFile(file, 'utf8');
  const controller = new AbortController();
  controller.abort();
  await expect(writeDeathReviewCache(directory, match, [], controller.signal)).rejects.toThrow();
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  expect(await fs.readdir(directory)).toEqual([`${match.checksum}.json`]);
  await expect(readDeathReviewCache(directory, { ...match, checksum: '../unsafe' })).rejects.toThrow('checksum');
});
