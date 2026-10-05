import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import type { ControlImportQueuePayload } from 'csdm/common/types/import-progress';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useImportProgress } from './import-progress-provider';

export function ImportQueueControls() {
  const { progress, refresh } = useImportProgress();
  const client = useWebSocketClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const act = async (action: ControlImportQueuePayload['action']) => {
    setBusy(true);
    setFailed(false);
    try {
      await client.send({ name: RendererClientMessageName.ControlImportQueue, payload: { action } });
      refresh();
    } catch (error) {
      logger.error(error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (!progress) return null;
  return (
    <div className="flex flex-wrap items-center gap-8">
      <Button isDisabled={busy} onClick={() => act(progress.queuePaused ? 'resume' : 'pause')}>
        {progress.queuePaused ? <Trans>Resume queue</Trans> : <Trans>Pause queue</Trans>}
      </Button>
      <Button isDisabled={busy || progress.analyzing === 0} onClick={() => act('cancel-active')}>
        <Trans>Cancel current parsing</Trans>
      </Button>
      <Button isDisabled={busy || progress.caching === 0} onClick={() => act('cancel-cache')}>
        <Trans>Cancel cache generation</Trans>
      </Button>
      <Button isDisabled={busy || progress.pending === 0} onClick={() => act('remove-pending')}>
        <Trans>Remove queued analyses</Trans>
      </Button>
      <span className="text-caption text-gray-600">
        <Trans>Pausing stops new analyses. Saving already parsed data finishes safely.</Trans>
      </span>
      {progress.queuePaused && progress.pending > 0 && (
        <p className="text-caption text-gray-600">
          <Trans>
            Paused jobs stay in the background. Finish or remove queued jobs before updating or stopping the background
            service.
          </Trans>
        </p>
      )}
      {progress.inserting > 0 && (
        <span className="text-caption text-gray-600">
          <Trans>Saving match data cannot be interrupted. Pause the queue to stop after the current save.</Trans>
        </span>
      )}
      {failed && (
        <p role="alert" className="text-red-500">
          <Trans>Could not change the queue. Please retry.</Trans>
        </p>
      )}
    </div>
  );
}
