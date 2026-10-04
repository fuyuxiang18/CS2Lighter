import { db } from 'csdm/node/database/database';
import { invalidateDemoCaches } from 'csdm/node/demo-cache/invalidate-demo-cache';

export async function deleteMatchesByChecksums(checksums: string[]) {
  try {
    await db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('matches').where('checksum', 'in', checksums).execute();
    });
    // In-flight writers see the invalidation generation and cannot resurrect deleted data.
    await invalidateDemoCaches(checksums);
  } catch (error) {
    logger.error('Error while deleting matches');
    logger.error(error);
    throw error;
  }
}
