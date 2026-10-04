import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ImportProgress } from 'csdm/common/types/import-progress';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';

type ImportProgressState = {
  progress: ImportProgress | null;
  failed: boolean;
  refresh: () => void;
};

const ImportProgressContext = createContext<ImportProgressState | null>(null);

export function ImportProgressProvider({ children }: { children: ReactNode }) {
  const client = useWebSocketClient();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let receivedPush = false;
    const onProgress = (nextProgress: ImportProgress) => {
      receivedPush = true;
      setProgress(nextProgress);
      setFailed(false);
    };
    client.on(ServerPushMessageName.ImportProgressUpdated, onProgress);
    void client
      .send({ name: RendererClientMessageName.GetImportProgress })
      .then((nextProgress) => {
        if (!cancelled && !receivedPush) {
          setProgress(nextProgress);
          setFailed(false);
        }
      })
      .catch((error) => {
        logger.error(error);
        if (!cancelled && !receivedPush) setFailed(true);
      });
    return () => {
      cancelled = true;
      client.off(ServerPushMessageName.ImportProgressUpdated, onProgress);
    };
  }, [client, revision]);

  return (
    <ImportProgressContext.Provider value={{ progress, failed, refresh }}>{children}</ImportProgressContext.Provider>
  );
}

export function useImportProgress() {
  const context = useContext(ImportProgressContext);
  if (!context) throw new Error('ImportProgressProvider is required');
  return context;
}
