import React, { useEffect, useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import type { ReviewClip } from 'csdm/common/types/review-clip';
import type { ReviewBattleRequest } from 'csdm/common/types/review-batch';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { HabitsPlaybackButton } from './habits-playback-button';
import { ReviewButton } from './review-button';
import { ReviewBatchStudio } from './review-batch-studio';
import { VideoAiReviewPanel } from './video-ai-review-panel';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';

export function ReviewClipButton({ request }: { request: ReviewBattleRequest }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="flex w-full min-w-0 flex-col gap-12">
      <div>
        <ReviewButton onClick={() => setOpened(!opened)}>
          {opened ? <Trans>Close POV</Trans> : <Trans>Watch real POV</Trans>}
        </ReviewButton>
      </div>
      {opened && <ReviewClipViewer key={JSON.stringify(request)} request={request} />}
    </div>
  );
}

export function ReviewClipViewer({ request }: { request: ReviewBattleRequest }) {
  const client = useWebSocketClient();
  const [legacyClip, setLegacyClip] = useState<ReviewClip | null>(null);
  const legacyVideoRef = useRef<HTMLVideoElement>(null);
  const { openSettings } = useSettingsOverlay();
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    let disposed = false;
    void client
      .send({ name: RendererClientMessageName.GetReviewClip, payload: JSON.parse(requestKey) })
      .then(({ clip }) => {
        if (!disposed && clip.status === 'ready') setLegacyClip(clip);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [client, requestKey]);
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <ReviewBatchStudio requests={[request]} steamId={request.steamId} />
      {legacyClip?.videoUrl && (
        <details className="min-w-0 rounded-8 border border-gray-300 p-16">
          <summary className="cursor-pointer text-gray-700">
            <Trans>Previously saved single POV clip</Trans>
          </summary>
          <video
            ref={legacyVideoRef}
            className="mt-12 aspect-video w-full rounded-8 bg-black"
            src={legacyClip.videoUrl}
            controls={true}
            preload="metadata"
          />
          <p className="mt-8 text-caption text-gray-600">
            <Trans>Your older video is still available. Edited review videos are saved separately.</Trans>
          </p>
          <VideoAiReviewPanel
            source={{ kind: 'clip', request }}
            onConfigure={() => openSettings(SettingsCategory.Ai)}
            onSeek={(seconds) => {
              if (legacyVideoRef.current) legacyVideoRef.current.currentTime = seconds;
            }}
          />
        </details>
      )}
      <HabitsPlaybackButton
        checksum={request.checksum}
        steamId={request.steamId}
        tick={request.startTick}
        roundNumber={request.roundNumber}
      />
    </div>
  );
}
