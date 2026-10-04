import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { ImportProgressTracker } from './import-progress-tracker';

let updateTimer: NodeJS.Timeout | undefined;
export const importProgress = new ImportProgressTracker(() => {
  // A large folder scan may update thousands of entries. Send one combined snapshot per short interval.
  updateTimer ??= setTimeout(() => {
    updateTimer = undefined;
    server.sendPushMessage({ name: ServerPushMessageName.ImportProgressUpdated, payload: importProgress.snapshot() });
  }, 100);
});
