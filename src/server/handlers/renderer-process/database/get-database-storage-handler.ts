import { getDatabaseStorage } from 'csdm/node/database/get-database-storage';
import { handleError } from '../../handle-error';

export async function getDatabaseStorageHandler() {
  try {
    return await getDatabaseStorage();
  } catch (error) {
    handleError(error, 'Error while reading database storage metadata');
  }
}
