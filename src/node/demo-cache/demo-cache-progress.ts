import type { DemoCacheDirectory } from 'csdm/common/types/demo-data-cache';
import type { ImportFileStatus } from 'csdm/common/types/import-progress';

type CacheProgressListener = {
  begin(): void;
  end(): void;
  directory(value: DemoCacheDirectory): void;
  update(filePath: string, status: ImportFileStatus, details?: { reason?: string; message?: string }): void;
};

// Node/CLI cache code stays independent of the WebSocket server. The daemon installs its progress observer.
let listener: CacheProgressListener | undefined;
export function setDemoCacheProgressListener(value: CacheProgressListener) {
  listener = value;
}
export const demoCacheProgress = {
  begin: () => listener?.begin(),
  end: () => listener?.end(),
  directory: (value: DemoCacheDirectory) => listener?.directory(value),
  update: (filePath: string, status: ImportFileStatus, details?: { reason?: string; message?: string }) =>
    listener?.update(filePath, status, details),
};
