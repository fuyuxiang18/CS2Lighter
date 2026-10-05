import React, { useState, type ReactNode } from 'react';
import { Trans } from '@lingui/react/macro';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ConfirmDialog } from 'csdm/ui/dialogs/confirm-dialog';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import type { OptimizeDatabasePayload } from 'csdm/server/handlers/renderer-process/database/optimize-database-handler';
import { useDialog } from 'csdm/ui/components/dialogs/use-dialog';
import { ErrorMessage } from 'csdm/ui/components/error-message';

type State = {
  isBusy: boolean;
  error: ReactNode | undefined;
  payload: OptimizeDatabasePayload;
};

function OptimizeDatabaseDialog() {
  const client = useWebSocketClient();
  const { hideDialog } = useDialog();
  const [state, setState] = useState<State>({
    error: undefined,
    isBusy: false,
    payload: {
      clearOrphanDemos: false,
      clearDemos: false,
    },
  });
  const isConfirmButtonDisabled = !Object.values(state.payload).some(Boolean) || state.isBusy;

  const onConfirmClick = async () => {
    try {
      setState({
        ...state,
        isBusy: true,
      });

      await client.send({
        name: RendererClientMessageName.OptimizeDatabase,
        payload: state.payload,
      });

      hideDialog();
    } catch (error) {
      setState({
        ...state,
        isBusy: false,
        error: typeof error === 'string' ? error : <Trans>An error occurred.</Trans>,
      });
    }
  };

  return (
    <ConfirmDialog
      title={<Trans>Clean library references</Trans>}
      onConfirm={onConfirmClick}
      closeOnConfirm={false}
      isBusy={state.isBusy}
      isConfirmButtonDisabled={isConfirmButtonDisabled}
      confirmButtonVariant={ButtonVariant.Danger}
    >
      <p className="mb-8 text-caption">
        <Trans>
          This only cleans file references and unimported metadata. Saved matches and player trajectories are preserved;
          it does not compact database files.
        </Trans>
      </p>
      <Checkbox
        label={<Trans>Remove unavailable file references</Trans>}
        isChecked={state.payload.clearOrphanDemos}
        isDisabled={state.isBusy}
        onChange={(event) => {
          setState({
            ...state,
            payload: {
              ...state.payload,
              clearOrphanDemos: event.target.checked,
            },
          });
        }}
      />
      <Checkbox
        label={<Trans>Clear unimported demo metadata</Trans>}
        isChecked={state.payload.clearDemos}
        isDisabled={state.isBusy}
        onChange={(event) => {
          setState({
            ...state,
            payload: {
              ...state.payload,
              clearDemos: event.target.checked,
            },
          });
        }}
      />
      {state.error !== undefined && (
        <div className="mt-8">
          <ErrorMessage message={state.error} />
        </div>
      )}
    </ConfirmDialog>
  );
}

export function OptimizeDatabaseButton() {
  const { showDialog } = useDialog();

  const onClick = () => {
    showDialog(<OptimizeDatabaseDialog />);
  };

  return (
    <Button onClick={onClick}>
      <Trans>Clean library references</Trans>
    </Button>
  );
}
