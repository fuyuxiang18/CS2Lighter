import type { ControlImportQueuePayload } from 'csdm/common/types/import-progress';
import { analysesListener } from 'csdm/server/analyses-listener';
import { importProgress } from 'csdm/server/import-progress';

export async function controlImportQueueHandler(payload: ControlImportQueuePayload) {
  if (
    !payload ||
    !['pause', 'resume', 'cancel-active', 'cancel-cache', 'remove-pending'].includes(payload.action) ||
    (payload.checksums !== undefined &&
      (!Array.isArray(payload.checksums) || payload.checksums.some((value) => typeof value !== 'string')))
  )
    throw new Error('Invalid import queue action');
  await analysesListener.control(payload);
  return importProgress.snapshot();
}
