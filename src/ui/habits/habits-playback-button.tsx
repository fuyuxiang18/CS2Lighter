import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { useDialog } from 'csdm/ui/components/dialogs/use-dialog';
import { CounterStrikeRunningDialog } from 'csdm/ui/components/dialogs/counter-strike-running-dialog';
import { useShowToast } from 'csdm/ui/components/toasts/use-show-toast';
import { useCounterStrike } from 'csdm/ui/hooks/use-counter-strike';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';

type Props = { checksum: string; steamId: string; tick?: number; roundNumber?: number };

export function HabitsPlaybackButton({ checksum, steamId, tick, roundNumber }: Props) {
  const client = useWebSocketClient();
  const { watchDemo, isKillCsRequired } = useCounterStrike();
  const { showDialog } = useDialog();
  const showToast = useShowToast();
  const [busy, setBusy] = useState(false);

  const play = async () => {
    try {
      const match = await client.send({ name: RendererClientMessageName.FetchMatchByChecksum, payload: checksum });
      const round = match.rounds.find((round) => round.number === roundNumber);
      await watchDemo({
        demoPath: match.demoFilePath,
        focusSteamId: steamId,
        startTick: tick ?? round?.freezetimeEndTick ?? 0,
      });
    } catch (error) {
      logger.error(error);
      showToast({
        type: 'error',
        content: <Trans>Could not open the demo in CS2. Check that the demo file and the game are available.</Trans>,
      });
    }
  };

  return (
    <Button
      isDisabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (await isKillCsRequired()) {
            showDialog(<CounterStrikeRunningDialog onConfirmClick={play} />);
          } else {
            await play();
          }
        } catch (error) {
          logger.error(error);
          showToast({ type: 'error', content: <Trans>Could not check the CS2 connection. Please try again.</Trans> });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trans>Watch POV in CS2</Trans>
    </Button>
  );
}
