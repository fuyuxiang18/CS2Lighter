import { retryFailedImports } from 'csdm/server/tasks/auto-import-demo-folders';
import { handleError } from '../../handle-error';

export async function retryFailedImportsHandler() {
  try {
    await retryFailedImports();
  } catch (error) {
    handleError(error, 'Unable to retry failed local imports');
  }
}
