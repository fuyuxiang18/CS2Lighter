import React, { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import type { ReviewPovState } from 'csdm/common/types/review-clip';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { ReviewButton } from './review-button';

type Props = { checksum: string; steamId: string; tick: number; roundNumber: number };

export function HabitsPlaybackButton({ checksum, steamId, tick, roundNumber }: Props) {
  const client = useWebSocketClient();
  const { openSettings } = useSettingsOverlay();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ReviewPovState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const update = (next: ReviewPovState) => {
      if (next.request.checksum === checksum && next.request.steamId === steamId && next.request.startTick === tick) {
        setState(next);
        setFailed(next.status === 'failed');
        if (next.status !== 'opening') setBusy(false);
      }
    };
    client.on(ServerPushMessageName.ReviewPovUpdated, update);
    return () => client.off(ServerPushMessageName.ReviewPovUpdated, update);
  }, [client, checksum, steamId, tick]);
  const play = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const next = await client.send({
        name: RendererClientMessageName.WatchReviewPov,
        payload: { checksum, steamId, roundNumber, startTick: tick },
      });
      setState((previous) => (previous?.status === 'open' && next.status === 'opening' ? previous : next));
      setFailed(next.status === 'failed');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <div>
        <ReviewButton
          disabled={busy || state?.status === 'opening' || state?.status === 'open'}
          onClick={() => void play()}
        >
          {busy || state?.status === 'opening' ? (
            <Trans>Opening CS2…</Trans>
          ) : state?.status === 'open' ? (
            <Trans>CS2 is open</Trans>
          ) : (
            <Trans>Watch POV in CS2</Trans>
          )}
        </ReviewButton>
      </div>
      {state?.status === 'open' && (
        <p role="status" className="text-caption text-gray-600">
          <Trans>Close CS2 when finished to record another clip.</Trans>
        </p>
      )}
      {failed && (
        <div role="alert" className="flex flex-col gap-8 text-caption text-gray-700">
          <p>
            {state?.issue === 'game-running' ? (
              <Trans>Close the running CS2 session before opening this POV.</Trans>
            ) : state?.issue === 'game-files-conflict' ? (
              <Trans>
                An unfinished replay setup was found in the game folder. Finish or restore that setup before recording.
              </Trans>
            ) : (
              <Trans>
                Could not open the POV. Start Steam and check the CS2 path, HLAE installation and original demo. Your
                existing game will not be closed automatically.
              </Trans>
            )}
          </p>
          <div>
            <ReviewButton
              onClick={() =>
                openSettings(state?.issue === 'cs2-missing' ? SettingsCategory.Playback : SettingsCategory.Video)
              }
            >
              <Trans>Recording setup</Trans>
            </ReviewButton>
          </div>
        </div>
      )}
    </div>
  );
}
