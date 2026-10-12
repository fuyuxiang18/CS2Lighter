import path from 'node:path';
import { getDemoCacheDirectory } from 'csdm/node/demo-cache/cache-directory';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { assertMatchImportComplete } from 'csdm/node/database/matches/match-import-state';
import { DeathReviewService } from './death-review-service';
import { readDeathReviewCache, writeDeathReviewCache } from './death-review-cache';
import { buildDeathMatchFromDatabase, isDeathMatchCurrent, listDeathMatches } from './fetch-death-match';

async function directory() {
  return path.join((await getDemoCacheDirectory()).path, 'death-review');
}

export const deathReview = new DeathReviewService({
  listMatches: listDeathMatches,
  read: async (match) => {
    await assertMatchImportComplete(match.checksum);
    return readDeathReviewCache(await directory(), match);
  },
  build: buildDeathMatchFromDatabase,
  isCurrent: isDeathMatchCurrent,
  write: async (match, records, signal) => writeDeathReviewCache(await directory(), match, records, signal),
  canStart: () => !isUpdateMaintenance(),
  changed: (progress) =>
    server.sendPushMessage({
      name: ServerPushMessageName.DeathReviewProgressUpdated,
      payload: progress,
    }),
});
