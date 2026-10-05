import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';

// Bump when persisted fields, habits binning or personal-statistics formulas change.
export const DEMO_CACHE_SCHEMA_VERSION = 3;
const memory = new Map<string, { stamp: string; bytes: number; cache: DemoDataCache }>();
const reads = new Map<string, Promise<DemoDataCache | undefined>>();
let memoryBytes = 0;
function forget(file: string) {
  memoryBytes -= memory.get(file)?.bytes ?? 0;
  memory.delete(file);
}

function cachePath(directory: string, checksum: string) {
  if (!/^[a-f0-9]{1,64}$/.test(checksum)) {
    throw new Error('Invalid demo cache checksum');
  }
  return path.join(directory, `${checksum}.json`);
}

export async function readCacheFile(directory: string, checksum: string): Promise<DemoDataCache | undefined> {
  const file = cachePath(directory, checksum);
  const pending = reads.get(file);
  if (pending) return pending;
  const promise = readAndValidateCache(file, checksum).finally(() => reads.delete(file));
  reads.set(file, promise);
  return promise;
}

async function readAndValidateCache(file: string, checksum: string): Promise<DemoDataCache | undefined> {
  try {
    const metadata = await stat(file);
    const stamp = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    const saved = memory.get(file);
    if (saved?.stamp === stamp) {
      memory.delete(file);
      memory.set(file, saved);
      return saved.cache;
    }
    forget(file);
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
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
    while (memory.size > 0 && (memoryBytes + metadata.size > 128 * 1024 ** 2 || memory.size >= 64)) {
      forget(memory.keys().next().value!);
    }
    if (metadata.size <= 128 * 1024 ** 2) {
      memory.set(file, { stamp, bytes: metadata.size, cache: cache as DemoDataCache });
      memoryBytes += metadata.size;
    }
    return cache as DemoDataCache;
  } catch (error) {
    forget(file);
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
    forget(destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function deleteCacheFile(directory: string, checksum: string) {
  const file = cachePath(directory, checksum);
  forget(file);
  await rm(file, { force: true });
}
