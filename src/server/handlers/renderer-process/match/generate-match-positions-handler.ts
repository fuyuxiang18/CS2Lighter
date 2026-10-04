import { handleError } from '../../handle-error';
import type { DemoSource } from 'csdm/common/types/counter-strike';
import { generateMatchPositions } from 'csdm/node/database/matches/generate-match-positions';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { server } from 'csdm/server/server';
import { importProgress } from 'csdm/server/import-progress';
import { getDemoCacheFailures } from 'csdm/node/demo-cache/demo-cache-service';

export type GenerateMatchPositionsPayload = {
  checksum: string;
  demoPath: string;
  source: DemoSource;
};

export async function generateMatchPositionsHandler({ checksum, demoPath, source }: GenerateMatchPositionsPayload) {
  try {
    importProgress.update(demoPath, 'analyzing');
    await generateMatchPositions({
      demoPath,
      checksum,
      source,
      onInsertionStart: () => {
        importProgress.update(demoPath, 'inserting');
        server.sendPushMessage({
          name: ServerPushMessageName.InsertingMatchPositions,
        });
      },
    });
    importProgress.update(demoPath, 'completed');
  } catch (error) {
    importProgress.update(demoPath, 'failed', {
      reason: getDemoCacheFailures().has(demoPath) ? 'cache' : 'analysis',
      message: error instanceof Error ? error.message : String(error),
    });
    handleError(error, 'Error while generating match positions');
  }
}
