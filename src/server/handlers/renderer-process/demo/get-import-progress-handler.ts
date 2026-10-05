import { importProgress } from 'csdm/server/import-progress';
import { analysesListener } from 'csdm/server/analyses-listener';
import { getIncompleteMatchImports, isMatchImportActive } from 'csdm/node/database/matches/match-import-state';

export async function getImportProgressHandler() {
  await analysesListener.restoreControls();
  for (const entry of (await getIncompleteMatchImports()).values()) {
    if (!isMatchImportActive(entry.checksum))
      importProgress.update(entry.demoPath, 'failed', {
        reason: 'insertion',
        message: 'The previous import did not finish. Retry this file explicitly to complete it.',
      });
  }
  return Promise.resolve(importProgress.snapshot());
}
