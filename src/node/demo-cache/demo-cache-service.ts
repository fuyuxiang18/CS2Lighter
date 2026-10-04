import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';
import { computePersonalMatchStats } from 'csdm/node/database/personal-stats/compute-personal-match-stats';
import { getDemoCacheDirectory } from './cache-directory';
import { DEMO_CACHE_SCHEMA_VERSION, deleteCacheFile, readCacheFile, writeCacheFile } from './cache-storage';
import { getDemoCacheDescriptor } from './demo-cache-descriptor';
import { buildDemoHabits } from './build-demo-habits';
import { getDemoCacheGeneration } from './invalidate-demo-cache';
import { demoCacheProgress } from './demo-cache-progress';

const inFlight = new Map<string, Promise<DemoDataCache>>();
const failures = new Map<string, { checksum: string; message: string }>();
let buildQueue: Promise<unknown> = Promise.resolve();

export function getDemoCacheFailures() {
  return new Map(failures);
}

/** Uses small match metadata to validate a durable cache. Only a miss reads raw positions. */
export function ensureDemoCache(checksum: string, demoPath?: string): Promise<DemoDataCache> {
  const existing = inFlight.get(checksum);
  if (existing) return existing;
  const promise = readOrBuild(checksum, demoPath).finally(() => inFlight.delete(checksum));
  inFlight.set(checksum, promise);
  return promise;
}

async function readOrBuild(checksum: string, demoPath?: string): Promise<DemoDataCache> {
  let filePath = demoPath ?? checksum;
  try {
    const descriptor = await getDemoCacheDescriptor(checksum);
    filePath = descriptor.match.demoPath;
    const directory = await getDemoCacheDirectory();
    demoCacheProgress.directory(directory);
    const saved = await readCacheFile(directory.path, checksum);
    if (saved?.revision === descriptor.revision) {
      failures.delete(filePath);
      return saved;
    }
    // Multiple imports may insert concurrently, but raw-position aggregation has a bounded memory footprint.
    demoCacheProgress.update(filePath, 'caching');
    const build = buildQueue
      .catch(() => {})
      .then(async () => {
        const generation = getDemoCacheGeneration(checksum);
        const current = await getDemoCacheDescriptor(checksum);
        const habitsBySteamId = await buildDemoHabits(current.match);
        const metrics = await computePersonalMatchStats(checksum);
        const fresh = await getDemoCacheDescriptor(checksum);
        if (generation !== getDemoCacheGeneration(checksum) || current.revision !== fresh.revision) {
          throw new Error('Match data changed while its cache was being generated; retry to use the latest data.');
        }
        const cache: DemoDataCache = {
          format: 'cs2-parser-demo-data',
          schemaVersion: DEMO_CACHE_SCHEMA_VERSION,
          checksum,
          revision: current.revision,
          generatedAt: new Date().toISOString(),
          match: current.match,
          habitsBySteamId,
          metrics,
        };
        await writeCacheFile(directory.path, cache);
        if (generation !== getDemoCacheGeneration(checksum)) {
          await deleteCacheFile(directory.path, checksum);
          throw new Error('Match was removed while its cache was being saved.');
        }
        return cache;
      });
    buildQueue = build;
    const cache = await build;
    failures.delete(filePath);
    return cache;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.set(filePath, { checksum, message });
    demoCacheProgress.update(filePath, 'failed', { reason: 'cache', message });
    throw error;
  }
}

/** Reports a real per-demo operation for backfill or compact cross-match aggregation. */
export async function loadDemoCaches(
  checksums: string[],
  onLoaded?: (cache: DemoDataCache, index: number, total: number) => void | Promise<void>,
): Promise<DemoDataCache[]> {
  const unique = [...new Set(checksums)];
  demoCacheProgress.begin();
  const results: DemoDataCache[] = [];
  let firstError: unknown;
  try {
    const entries = await Promise.all(
      unique.map(async (checksum) => {
        return getDemoCacheDescriptor(checksum);
      }),
    );
    for (const { match } of entries) demoCacheProgress.update(match.demoPath, 'pending');
    for (const [index, { match }] of entries.entries()) {
      try {
        const cache = await ensureDemoCache(match.checksum, match.demoPath);
        if (onLoaded) {
          demoCacheProgress.update(match.demoPath, 'profiling');
          await onLoaded(cache, index + 1, entries.length);
        }
        results.push(cache);
        demoCacheProgress.update(match.demoPath, 'completed');
      } catch (error) {
        firstError ??= error;
        demoCacheProgress.update(match.demoPath, 'failed', {
          reason: 'cache',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (firstError) throw firstError;
    return results;
  } finally {
    demoCacheProgress.end();
  }
}

export async function retryFailedDemoCaches() {
  const failed = [...failures.values()];
  if (failed.length > 0) await loadDemoCaches(failed.map((failure) => failure.checksum));
}
