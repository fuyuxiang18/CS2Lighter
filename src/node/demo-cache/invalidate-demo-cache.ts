import path from 'node:path';
import { rm } from 'node:fs/promises';
import { getDemoCacheDirectory } from './cache-directory';
import { deleteCacheFile } from './cache-storage';
import { advanceDemoCacheGeneration, waitForDemoCacheWrites } from './cache-generation';

export { getDemoCacheGeneration } from './cache-generation';

export async function invalidateDemoCaches(checksums: string[]) {
  if (checksums.length === 0) return;
  const selected = [...new Set(checksums)];
  if (selected.some((checksum) => !/^[a-f0-9]{1,64}$/.test(checksum))) throw new Error('Invalid demo cache checksum');
  for (const checksum of selected) advanceDemoCacheGeneration(checksum);
  try {
    const directory = await getDemoCacheDirectory();
    const results = await Promise.allSettled(
      selected.map(async (checksum) => {
        await waitForDemoCacheWrites(checksum);
        const deletions = await Promise.allSettled([
          deleteCacheFile(directory.path, checksum),
          rm(path.join(directory.path, 'death-review', `${checksum}.json`), { force: true }),
          rm(path.join(directory.path, 'death-evidence', `${checksum}.json.gz`), { force: true }),
        ]);
        const failure = deletions.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  } catch (error) {
    // The DB revision check still rejects stale files. A cache permission problem must not roll back a DB operation.
    logger.error('Unable to remove stale demo cache files');
    logger.error(error);
  }
}
