import { throwErrorMessage } from 'csdm/server/handlers/throw-error-message';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { deleteOrphanDemoPaths } from 'csdm/node/database/demos/delete-orphan-demo-paths';
import { deleteDemos } from 'csdm/node/database/demos/delete-demos';

export type OptimizeDatabasePayload = {
  clearOrphanDemos: boolean;
  clearDemos: boolean;
};

export async function optimizeDatabaseHandler(payload: OptimizeDatabasePayload) {
  try {
    // Reject old clients explicitly: library cleanup must never erase useful trajectory data.
    if ('clearPositions' in payload && payload.clearPositions !== false) {
      throw new Error('Deleting player trajectories is no longer supported by library cleanup.');
    }
    const { clearOrphanDemos, clearDemos } = payload;
    if (clearDemos) {
      await deleteDemos();
    } else if (clearOrphanDemos) {
      await deleteOrphanDemoPaths();
    }

    server.sendPushMessage({
      name: ServerPushMessageName.OptimizeDatabaseSuccess,
    });
  } catch (error) {
    throwErrorMessage(error, 'Error while optimizing database');
  }
}
