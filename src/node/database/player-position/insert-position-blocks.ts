import { db } from 'csdm/node/database/database';
import { streamPositionBlocks } from './stream-position-blocks';

/** Stream directly into bounded blocks; an invalid CSV rolls back all player tracks. */
export async function insertPositionBlocks(csvFilePath: string) {
  await db.transaction().execute(async (transaction) => {
    await streamPositionBlocks(csvFilePath, async (block) => {
      await transaction.insertInto('player_position_blocks').values(block).execute();
    });
  });
}
