import { getDemoCacheDirectory } from './cache-directory';
import { deleteCacheFile } from './cache-storage';

const generations = new Map<string, number>();
export function getDemoCacheGeneration(checksum: string) {
  return generations.get(checksum) ?? 0;
}

export async function invalidateDemoCaches(checksums: string[]) {
  if (checksums.length === 0) return;
  for (const checksum of checksums) {
    generations.set(checksum, getDemoCacheGeneration(checksum) + 1);
  }
  try {
    const directory = await getDemoCacheDirectory();
    await Promise.all(checksums.map((checksum) => deleteCacheFile(directory.path, checksum)));
  } catch (error) {
    // The DB revision check still rejects stale files. A cache permission problem must not roll back a DB operation.
    logger.error('Unable to remove stale demo cache files');
    logger.error(error);
  }
}
