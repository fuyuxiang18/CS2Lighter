import { db } from 'csdm/node/database/database';
import { invalidateDemoCaches } from 'csdm/node/demo-cache/invalidate-demo-cache';
import { clearIncompleteMatchImports, isMatchImportActive } from './match-import-state';

export async function deleteMatchesByChecksums(checksums: string[], options?: { preserveImportState?: boolean }) {
  try {
    if (!options?.preserveImportState && checksums.some(isMatchImportActive))
      throw new Error('A match is still being saved');
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('matches').where('checksum', 'in', checksums).execute();
    });
    // In-flight writers see the invalidation generation and cannot resurrect deleted data.
    await invalidateDemoCaches(checksums);
    if (!options?.preserveImportState) await clearIncompleteMatchImports(checksums);
  } catch (error) {
    logger.error('Error while deleting matches');
    logger.error(error);
    throw error;
  }
}
