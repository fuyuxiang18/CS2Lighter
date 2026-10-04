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

/** Reading saved summaries is page-local work. Only missing/stale caches enter the global import gate. */
export async function loadDemoCaches(
  checksums: string[],
  onLoaded?: (cache: DemoDataCache, index: number, total: number) => void | Promise<void>,
): Promise<DemoDataCache[]> {
  const unique = [...new Set(checksums)];
  if (unique.length === 0) return [];
  const results: DemoDataCache[] = [];
  let firstError: unknown;
  let reporting = false;
  function track(filePath: string) {
    if (!reporting) {
      reporting = true;
      demoCacheProgress.begin();
    }
    demoCacheProgress.update(filePath, 'pending');
  }
  try {
    const directory = await getDemoCacheDirectory();
    const descriptors = await Promise.all(unique.map(getDemoCacheDescriptor));
    const entries: { match: DemoDataCache['match']; cache?: DemoDataCache; generation: number; tracked: boolean }[] =
      [];
    // Validate files before deciding whether this is an import. Keep file reads sequential, rather than
    // opening every file in a large library at once. No position queries run on this path.
    for (const { match, revision } of descriptors) {
      const generation = getDemoCacheGeneration(match.checksum);
      const saved = await readCacheFile(directory.path, match.checksum).catch(() => undefined);
      const cache =
        saved?.revision === revision && generation === getDemoCacheGeneration(match.checksum) ? saved : undefined;
      entries.push({ match, cache, generation, tracked: cache === undefined });
    }
    for (const entry of entries) if (entry.tracked) track(entry.match.demoPath);
    for (const [index, entry] of entries.entries()) {
      const { match } = entry;
      try {
        if (entry.cache && entry.generation !== getDemoCacheGeneration(match.checksum)) {
          entry.cache = undefined;
          entry.tracked = true;
          track(match.demoPath);
        }
        const cache = entry.cache ?? (await ensureDemoCache(match.checksum, match.demoPath));
        failures.delete(match.demoPath);
        if (onLoaded) {
          if (entry.tracked) demoCacheProgress.update(match.demoPath, 'profiling');
          await onLoaded(cache, index + 1, entries.length);
        }
        results.push(cache);
        if (entry.tracked) demoCacheProgress.update(match.demoPath, 'completed');
      } catch (error) {
        firstError ??= error;
        if (entry.tracked) {
          demoCacheProgress.update(match.demoPath, 'failed', {
            reason: 'cache',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (firstError) throw firstError;
    return results;
  } finally {
    if (reporting) demoCacheProgress.end();
  }
}

export async function retryFailedDemoCaches() {
  const failed = [...failures.values()];
  if (failed.length > 0) {
    const caches = await loadDemoCaches(failed.map((failure) => failure.checksum));
    // A repaired file may now be a cache hit. An explicit retry still clears its old visible failure.
    for (const cache of caches) demoCacheProgress.update(cache.match.demoPath, 'completed');
  }
}
