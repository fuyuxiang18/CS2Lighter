import path from 'node:path';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { reviewBatches } from './review-batches';
import { resolveReviewBatch } from './resolve-review-batch';
import { RecordingQueueService } from './recording-queue-service';

export const recordingQueue = new RecordingQueueService({
  directory: () => path.join(getAppFolderPath(), 'recording-queue'),
  resolve: resolveReviewBatch,
  generate: (request) => reviewBatches.generate(request),
  listBatches: () => reviewBatches.list(),
  pause: (id) => reviewBatches.pause(id),
  cancel: (id) => {
    reviewBatches.cancel(id);
  },
  changed: (queue) => server.sendPushMessage({ name: ServerPushMessageName.RecordingQueueUpdated, payload: queue }),
});
