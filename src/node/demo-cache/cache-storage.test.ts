import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { DemoSource } from 'csdm/common/types/counter-strike';
import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';
import { DEMO_CACHE_SCHEMA_VERSION, readCacheFile, writeCacheFile, deleteCacheFile } from './cache-storage';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'cs2-cache-test-'));
});
afterEach(async () => {
  if (path.dirname(folder) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('cs2-cache-test-'))
    throw new Error('Invalid test cleanup path');
  await rm(folder, { recursive: true, force: true });
});
function cache(): DemoDataCache {
  return {
    format: 'cs2-parser-demo-data',
    schemaVersion: DEMO_CACHE_SCHEMA_VERSION,
    checksum: 'abcd',
    revision: 'revision',
    generatedAt: '2026-01-01',
    match: {
      checksum: 'abcd',
      demoPath: 'D:\\demo\\测试.dem',
      date: '2026-01-01',
      analyzeDate: '2026-01-02',
      mapName: 'de_mirage',
      buildNumber: 1,
      gameMode: 'competitive',
      source: DemoSource.PerfectWorld,
      tickrate: 64,
      singleLevelMap: true,
    },
    habitsBySteamId: {},
    metrics: [],
  };
}

describe('versioned atomic demo files', () => {
  it('shares a validated immutable-on-disk result across repeated readers, invalidating it after replacement or deletion', async () => {
    await writeCacheFile(folder, cache());
    const [first, second] = await Promise.all([readCacheFile(folder, 'abcd'), readCacheFile(folder, 'abcd')]);
    expect(first).toBe(second);
    expect(await readCacheFile(folder, 'abcd')).toBe(first);
    await writeCacheFile(folder, { ...cache(), revision: 'replacement' });
    const replacement = await readCacheFile(folder, 'abcd');
    expect(replacement).not.toBe(first);
    expect(replacement?.revision).toBe('replacement');
    await rm(path.join(folder, 'abcd.json'));
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
  });
  it('round-trips a Unicode path and atomically replaces one per-demo file', async () => {
    await writeCacheFile(folder, cache());
    expect(await readCacheFile(folder, 'abcd')).toMatchObject(cache());
    await writeCacheFile(folder, { ...cache(), revision: 'new-revision' });
    expect((await readCacheFile(folder, 'abcd'))?.revision).toBe('new-revision');
    expect(await readdir(folder)).toEqual(['abcd.json']);
    await deleteCacheFile(folder, 'abcd');
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
  });
  it('rejects truncated files, old schema versions and changed payloads', async () => {
    const file = path.join(folder, 'abcd.json');
    await writeFile(file, '{');
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
    await writeCacheFile(folder, { ...cache(), schemaVersion: 0 });
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
    await writeCacheFile(folder, cache());
    const value = JSON.parse(await readFile(file, 'utf8'));
    delete value.habitsBySteamId;
    await writeFile(file, JSON.stringify(value));
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
    await writeCacheFile(folder, cache());
    const changed = JSON.parse(await readFile(file, 'utf8'));
    changed.metrics = [{ corrupt: true }];
    await writeFile(file, JSON.stringify(changed));
    expect(await readCacheFile(folder, 'abcd')).toBeUndefined();
  });
  it('cleans temporary writes after a failed rename and rejects traversal', async () => {
    await mkdir(path.join(folder, 'abcd.json'));
    await expect(writeCacheFile(folder, cache())).rejects.toThrow();
    expect(await readdir(folder)).toEqual(['abcd.json']);
    await expect(readCacheFile(folder, '../outside')).rejects.toThrow('Invalid');
    await expect(deleteCacheFile(folder, '../outside')).rejects.toThrow('Invalid');
  });
});
