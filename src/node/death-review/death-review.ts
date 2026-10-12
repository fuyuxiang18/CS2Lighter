import path from 'node:path';
import { getDemoCacheDirectory } from 'csdm/node/demo-cache/cache-directory';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { assertMatchImportComplete } from 'csdm/node/database/matches/match-import-state';
import { DeathReviewService } from './death-review-service';
import { deathMatchRevision, readDeathReviewCache, writeDeathReviewCache } from './death-review-cache';
import { readDeathRiskReports } from './death-evidence-cache';
import { buildDeathMatchFromDatabase, isDeathMatchCurrent, listDeathMatches } from './fetch-death-match';

async function directory() {
  return path.join((await getDemoCacheDirectory()).path, 'death-review');
}

export const deathReview = new DeathReviewService({
  listMatches: listDeathMatches,
  read: async (match) => {
    await assertMatchImportComplete(match.checksum);
    const cacheDirectory = await directory();
    const records = await readDeathReviewCache(cacheDirectory, match);
    if (!records) return undefined;
    const risks = await readDeathRiskReports(
      path.join(path.dirname(cacheDirectory), 'death-evidence'),
      match.checksum,
      deathMatchRevision(match),
    );
    return records.map((record) => ({ ...record, risk: risks.get(`${record.steamId}:${record.id}`) }));
  },
  build: buildDeathMatchFromDatabase,
  isCurrent: isDeathMatchCurrent,
  write: async (match, records, signal, generation) =>
    writeDeathReviewCache(await directory(), match, records, signal, generation),
  canStart: () => !isUpdateMaintenance(),
  changed: (progress) =>
    server.sendPushMessage({
      name: ServerPushMessageName.DeathReviewProgressUpdated,
      payload: progress,
    }),
});
