import type { DemoDataCache } from 'csdm/common/types/demo-data-cache';
import { computePersonalMatchStats } from 'csdm/node/database/personal-stats/compute-personal-match-stats';
import { getDemoCacheDirectory } from './cache-directory';
import { DEMO_CACHE_SCHEMA_VERSION, deleteCacheFile, readCacheFile, writeCacheFile } from './cache-storage';
import { getDemoCacheDescriptor } from './demo-cache-descriptor';
import { buildDemoHabits } from './build-demo-habits';
import { getDemoCacheGeneration } from './invalidate-demo-cache';
import { demoCacheProgress } from './demo-cache-progress';
import { MatchImportIncompleteError, isMatchImportActive } from 'csdm/node/database/matches/match-import-state';

const inFlight = new Map<string, { generation: number; promise: Promise<DemoDataCache> }>();
const failures = new Map<string, { checksum: string; message: string }>();
const controllers = new Map<string, AbortController>();
const cancelled = new Map<string, number>();
let buildQueue: Promise<unknown> = Promise.resolve();

export function getDemoCacheFailures() {
  return new Map(failures);
}

/** Uses small match metadata to validate a durable cache. Only a miss reads raw positions. */
export function cancelDemoCacheBuilds(checksums?: string[]) {
  for (const [checksum, controller] of controllers) {
    if (checksums && !checksums.includes(checksum)) continue;
    cancelled.set(checksum, getDemoCacheGeneration(checksum));
    controller.abort(new Error('Cache generation was cancelled. Retry to rebuild from saved match data.'));
  }
}

export function ensureDemoCache(
  checksum: string,
  demoPath?: string,
  options?: { retry?: boolean },
): Promise<DemoDataCache> {
  if (options?.retry) cancelled.delete(checksum);
  if (cancelled.get(checksum) === getDemoCacheGeneration(checksum))
    return Promise.reject(new Error('Cache generation was cancelled. Retry to rebuild from saved match data.'));
  const existing = inFlight.get(checksum);
  const generation = getDemoCacheGeneration(checksum);
  if (existing?.generation === generation) return existing.promise;
  const promise = readOrBuild(checksum, demoPath).finally(() => {
    if (inFlight.get(checksum)?.promise === promise) inFlight.delete(checksum);
  });
  inFlight.set(checksum, { generation, promise });
  return promise;
}

async function readOrBuild(checksum: string, demoPath?: string): Promise<DemoDataCache> {
  let filePath = demoPath ?? checksum;
  try {
    const readGeneration = getDemoCacheGeneration(checksum);
    const descriptor = await getDemoCacheDescriptor(checksum);
    filePath = descriptor.match.demoPath;
    const directory = await getDemoCacheDirectory();
    demoCacheProgress.directory(directory);
    const saved = await readCacheFile(directory.path, checksum);
    if (readGeneration !== getDemoCacheGeneration(checksum))
      throw new Error('Match data changed while reading its cache.');
    if (saved?.revision === descriptor.revision) {
      failures.delete(filePath);
      return saved;
    }
    // Multiple imports may insert concurrently, but raw-position aggregation has a bounded memory footprint.
    demoCacheProgress.update(filePath, 'caching');
    const controller = new AbortController();
    controllers.set(checksum, controller);
    const started = performance.now();
    const build = buildQueue
      .catch(() => {})
      .then(async () => {
        controller.signal.throwIfAborted();
        const generation = getDemoCacheGeneration(checksum);
        const current = await getDemoCacheDescriptor(checksum);
        const habitsBySteamId = await buildDemoHabits(current.match, controller.signal);
        controller.signal.throwIfAborted();
        const metrics = await computePersonalMatchStats(checksum);
        controller.signal.throwIfAborted();
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
        controller.signal.throwIfAborted();
        await writeCacheFile(directory.path, cache);
        if (generation !== getDemoCacheGeneration(checksum)) {
          await deleteCacheFile(directory.path, checksum);
          throw new Error('Match was removed while its cache was being saved.');
        }
        return cache;
      })
      .finally(() => {
        if (controllers.get(checksum) === controller) controllers.delete(checksum);
      });
    buildQueue = build;
    const cache = await build;
    logger.log(`Import timing ${checksum}: cache ${Math.round(performance.now() - started)} ms including queue wait`);
    failures.delete(filePath);
    return cache;
  } catch (error) {
    if (error instanceof MatchImportIncompleteError && isMatchImportActive(error.checksum)) throw error;
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
  options?: { allowPartial?: boolean },
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
    const discovered = await Promise.allSettled(unique.map(getDemoCacheDescriptor));
    const descriptors: Awaited<ReturnType<typeof getDemoCacheDescriptor>>[] = [];
    for (const result of discovered) {
      if (result.status === 'fulfilled') descriptors.push(result.value);
      else {
        firstError ??= result.reason;
        if (result.reason instanceof MatchImportIncompleteError && !isMatchImportActive(result.reason.checksum)) {
          const error = result.reason;
          demoCacheProgress.update(error.demoPath, 'failed', { reason: 'insertion', message: error.message });
        }
      }
    }
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
    for (const entry of entries)
      if (entry.tracked && !isMatchImportActive(entry.match.checksum)) track(entry.match.demoPath);
    for (const [index, entry] of entries.entries()) {
      const { match } = entry;
      try {
        if (isMatchImportActive(match.checksum)) throw new MatchImportIncompleteError(match.checksum, match.demoPath);
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
        if (error instanceof MatchImportIncompleteError && isMatchImportActive(error.checksum)) continue;
        if (entry.tracked) {
          demoCacheProgress.update(match.demoPath, 'failed', {
            reason: 'cache',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (firstError && !options?.allowPartial) throw firstError;
    return results;
  } finally {
    if (reporting) demoCacheProgress.end();
  }
}

export async function retryFailedDemoCaches() {
  const failed = [...failures.values()];
  for (const failure of failed) cancelled.delete(failure.checksum);
  if (failed.length > 0) {
    const caches = await loadDemoCaches(failed.map((failure) => failure.checksum));
    // A repaired file may now be a cache hit. An explicit retry still clears its old visible failure.
    for (const cache of caches) demoCacheProgress.update(cache.match.demoPath, 'completed');
  }
}
