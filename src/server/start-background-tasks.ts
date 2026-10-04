import { Game } from 'csdm/common/types/counter-strike';
import { db } from 'csdm/node/database/database';
import { getDemoCacheDirectory } from 'csdm/node/demo-cache/cache-directory';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { importProgress } from './import-progress';
import { startAutoImportDemoFolders, stopAutoImportDemoFolders } from './tasks/auto-import-demo-folders';

let started = false;
let generation = 0;

export async function startBackgroundTasks() {
  if (started) return;
  started = true;
  const currentGeneration = generation;
  // Prepare existing matches from the database. A valid cache makes subsequent startups a compact read.
  importProgress.beginDiscovery();
  try {
    importProgress.setCacheDirectory(await getDemoCacheDirectory());
    const matches = await db
      .selectFrom('matches as m')
      .innerJoin('demos as d', 'd.checksum', 'm.checksum')
      .select('m.checksum')
      .where('d.game', '=', Game.CS2)
      .orderBy('d.date', 'desc')
      .execute();
    await loadDemoCaches(matches.map((match) => match.checksum));
  } catch (error) {
    logger.error('Unable to prepare local demo data cache');
    logger.error(error);
  } finally {
    if (currentGeneration === generation) startAutoImportDemoFolders();
    importProgress.finishDiscovery();
  }
}

export function stopBackgroundTasks() {
  started = false;
  generation += 1;
  stopAutoImportDemoFolders();
}
