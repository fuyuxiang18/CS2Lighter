import React, { useCallback, useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type {
  ReviewClip,
  ReviewClipInspection,
  ReviewClipIssue,
  ReviewClipRequest,
  ReviewClipStatus,
} from 'csdm/common/types/review-clip';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { HabitsPlaybackButton } from './habits-playback-button';
import { ReviewButton } from './review-button';

export function ReviewClipButton({ request }: { request: ReviewClipRequest }) {
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

export function ReviewClipViewer({ request }: { request: ReviewClipRequest }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const { openSettings } = useSettingsOverlay();
  const [inspection, setInspection] = useState<ReviewClipInspection | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const requestKey = JSON.stringify(request);
  const load = useCallback(async () => {
    setError(false);
    try {
      setInspection(
        await client.send({ name: RendererClientMessageName.GetReviewClip, payload: JSON.parse(requestKey) }),
      );
    } catch {
      setError(true);
    }
  }, [client, requestKey]);
  useEffect(() => {
    let canceled = false;
    const update = (clip: ReviewClip) => {
      if (canceled) return;
      setInspection((previous) => (previous?.clip.id === clip.id ? { ...previous, clip } : previous));
    };
    client.on(ServerPushMessageName.ReviewClipUpdated, update);
    void client
      .send({ name: RendererClientMessageName.GetReviewClip, payload: JSON.parse(requestKey) })
      .then((value) => {
        if (!canceled) setInspection(value);
      })
      .catch(() => {
        if (!canceled) setError(true);
      });
    return () => {
      canceled = true;
      client.off(ServerPushMessageName.ReviewClipUpdated, update);
    };
  }, [client, requestKey]);
  const generate = async () => {
    setBusy(true);
    setError(false);
    setMediaError(false);
    try {
      const value = await client.send({ name: RendererClientMessageName.GenerateReviewClip, payload: request });
      setInspection((previous) =>
        previous && previous.clip.id === value.clip.id && previous.clip.updatedAt > value.clip.updatedAt
          ? { ...value, clip: previous.clip }
          : value,
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!inspection) return;
    setBusy(true);
    try {
      await client.send({ name: RendererClientMessageName.CancelReviewClip, payload: { id: inspection.clip.id } });
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const issues: Record<ReviewClipIssue, string> = {
    'unsupported-platform': t`Clip recording currently requires Windows.`,
    'cs2-missing': t`Choose your CS2 installation in Playback settings.`,
    'hlae-missing': t`Install HLAE in Video settings to record the game.`,
    'ffmpeg-missing': t`Install FFmpeg in Video settings to save MP4 clips.`,
    'steam-not-running': t`Start Steam, then check again.`,
    'game-running': t`Close CS2 before recording. Your running game will not be stopped automatically.`,
    'game-files-conflict': t`An unfinished replay setup was found in the game folder. Finish or restore that setup before recording.`,
    'queue-busy': t`Another video is being recorded. Wait for it to finish.`,
    'demo-missing': t`The original demo is missing. Restore it to its imported folder.`,
    'demo-changed': t`The demo changed since import. Import the new file before recording.`,
    'invalid-request': t`This event has no valid recording range. Choose another event.`,
    'incompatible-path': t`Recording requires a writable path without special characters. Check the app and game locations.`,
    'insufficient-space': t`There is not enough free space for the recording.`,
    'recording-failed': t`CS2 recording failed. Check game compatibility and HLAE, then retry.`,
    'output-missing': t`No playable video was produced. Check CS2 and recording tools, then retry.`,
    interrupted: t`Recording was interrupted. You can retry this clip.`,
    'update-maintenance': t`An update is being installed. Retry after the app restarts.`,
  };
  const statuses: Record<ReviewClipStatus, string> = {
    missing: t`No saved clip yet`,
    queued: t`Waiting to record`,
    preparing: t`Preparing CS2`,
    recording: t`Recording real POV…`,
    encoding: t`Saving the video…`,
    ready: t`Saved locally`,
    failed: t`Recording failed`,
    canceled: t`Recording canceled`,
  };
  const clip = inspection?.clip;
  const active = clip && ['queued', 'preparing', 'recording', 'encoding'].includes(clip.status);
  const reasons = [
    ...new Set([...(inspection?.requirements.missingReasons ?? []), ...(clip?.issue ? [clip.issue] : [])]),
  ];
  return (
    <section className="flex min-w-0 flex-col gap-12 rounded-12 border border-accent-muted bg-gray-75 p-16">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <h3 className="text-body-strong">
          <Trans>Real first-person replay</Trans>
        </h3>
        <span role="status" className="text-caption text-gray-700">
          {clip ? statuses[clip.status] : t`Checking saved video…`}
        </span>
      </div>
      {clip?.status === 'ready' && clip.videoUrl ? (
        <>
          <video
            key={clip.videoUrl}
            controls={true}
            preload="metadata"
            className="aspect-video w-full rounded-8 bg-black"
            src={clip.videoUrl}
            onError={() => setMediaError(true)}
          />
          <p className="text-caption text-gray-600">
            <Trans>
              Rendered from the CS2 demo · player POV · no X-ray · not a screen recording from the original match.
            </Trans>
          </p>
          {mediaError && (
            <p role="alert" className="text-red-500">
              <Trans>
                This saved video could not be played. Open the POV directly in CS2, or check the recording tools.
              </Trans>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-gray-700">
            <Trans>
              Open this moment in CS2, or record it once for playback here. Recording opens a CS2 window and uses the
              game installation; keep Steam running.
            </Trans>
          </p>
          {reasons.map((reason) => (
            <p key={reason} className="text-caption text-gray-700">
              {issues[reason]}
            </p>
          ))}
          <div className="flex flex-wrap gap-8">
            {active ? (
              <ReviewButton disabled={busy} onClick={() => void cancel()}>
                <Trans>Cancel recording</Trans>
              </ReviewButton>
            ) : (
              <ReviewButton primary={true} disabled={busy || !inspection} onClick={() => void generate()}>
                <Trans>Record this POV clip</Trans>
              </ReviewButton>
            )}
            <ReviewButton disabled={busy} onClick={() => void load()}>
              <Trans>Check again</Trans>
            </ReviewButton>
            {reasons.some((reason) =>
              ['hlae-missing', 'ffmpeg-missing', 'recording-failed', 'incompatible-path'].includes(reason),
            ) && (
              <ReviewButton onClick={() => openSettings(SettingsCategory.Video)}>
                <Trans>Recording setup</Trans>
              </ReviewButton>
            )}
            {reasons.includes('cs2-missing') && (
              <ReviewButton onClick={() => openSettings(SettingsCategory.Playback)}>
                <Trans>Game setup</Trans>
              </ReviewButton>
            )}
          </div>
        </>
      )}
      <div>
        <HabitsPlaybackButton
          checksum={request.checksum}
          steamId={request.steamId}
          tick={request.startTick}
          roundNumber={request.roundNumber}
        />
      </div>
      {error && (
        <p role="alert" className="text-red-500">
          <Trans>Could not load or start this clip. Check the demo and recording setup, then retry.</Trans>
        </p>
      )}
    </section>
  );
}
