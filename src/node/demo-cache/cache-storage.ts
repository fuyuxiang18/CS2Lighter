import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';

// Bump when persisted fields, habits binning or personal-statistics formulas change.
export const DEMO_CACHE_SCHEMA_VERSION = 3;

function cachePath(directory: string, checksum: string) {
  if (!/^[a-f0-9]{1,64}$/.test(checksum)) {
    throw new Error('Invalid demo cache checksum');
  }
  return path.join(directory, `${checksum}.json`);
}

export async function readCacheFile(directory: string, checksum: string): Promise<DemoDataCache | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(cachePath(directory, checksum), 'utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const cache = value as Partial<DemoDataCache>;
    if (
      cache.format !== 'cs2-parser-demo-data' ||
      cache.schemaVersion !== DEMO_CACHE_SCHEMA_VERSION ||
      cache.checksum !== checksum ||
      typeof cache.revision !== 'string' ||
      !cache.match ||
      !cache.habitsBySteamId ||
      !Array.isArray(cache.metrics)
    )
      return undefined;
    const { contentHash, ...data } = cache;
    if (contentHash !== createHash('sha256').update(JSON.stringify(data)).digest('hex')) return undefined;
    return cache as DemoDataCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export async function writeCacheFile(directory: string, cache: DemoDataCache) {
  await mkdir(directory, { recursive: true });
  const destination = cachePath(directory, cache.checksum);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const data = { ...cache };
    delete data.contentHash;
    const contentHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    await writeFile(temporary, JSON.stringify({ ...data, contentHash }), { flag: 'wx' });
    // rename replaces an existing file atomically; a failed write leaves the previous valid cache intact.
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function deleteCacheFile(directory: string, checksum: string) {
  await rm(cachePath(directory, checksum), { force: true });
}
