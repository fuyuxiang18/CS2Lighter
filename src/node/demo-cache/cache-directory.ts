import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import type { DemoCacheDirectory } from 'csdm/common/types/demo-data-cache';

let directory: Promise<DemoCacheDirectory> | undefined;

export async function chooseDemoCacheDirectory(
  preferredPath: string,
  fallbackPath: string,
): Promise<DemoCacheDirectory> {
  async function probe(folder: string) {
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, `.write-test-${randomUUID()}`);
    await writeFile(file, '', { flag: 'wx' });
    await unlink(file);
  }
  try {
    await probe(preferredPath);
    return { path: preferredPath, preferredPath, isFallback: false };
  } catch (error) {
    if (preferredPath === fallbackPath) {
      throw error;
    }
    await probe(fallbackPath);
    return {
      path: fallbackPath,
      preferredPath,
      isFallback: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getDemoCacheDirectory(): Promise<DemoCacheDirectory> {
  if (directory === undefined) {
    const fallbackPath = path.join(getAppFolderPath(), 'demodata');
    // Explicit QA profiles must never probe or write the actual installation directory.
    const override = process.env.CS2_PARSER_DATA_DIR;
    const isolated = typeof override === 'string' && path.isAbsolute(override);
    const preferredPath = isolated || IS_DEV ? fallbackPath : path.join(path.dirname(process.execPath), 'demodata');
    directory = chooseDemoCacheDirectory(preferredPath, fallbackPath).catch((error: unknown) => {
      directory = undefined;
      throw error;
    });
  }
  return directory;
}
