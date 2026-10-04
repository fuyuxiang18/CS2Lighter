import { importProgress } from 'csdm/server/import-progress';

export function getImportProgressHandler() {
  return Promise.resolve(importProgress.snapshot());
}
