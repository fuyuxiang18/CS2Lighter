import React, { useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReviewBatch } from 'csdm/common/types/review-batch';
import { ReviewButton } from './review-button';
import { useReviewClipMessages } from './use-review-clip-messages';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { VideoAiReviewPanel } from './video-ai-review-panel';

export function ReviewBatchViewer({ batch, initialItemIndex }: { batch: ReviewBatch; initialItemIndex?: number }) {
  const { t } = useLingui();
  const { statuses } = useReviewClipMessages();
  const [itemIndex, setItemIndex] = useState<number | null>(
    () => initialItemIndex ?? (batch.items.length === 1 ? batch.items[0].index : null),
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const { openSettings } = useSettingsOverlay();
  const [mediaError, setMediaError] = useState(false);
  const item =
    itemIndex === null
      ? batch.videoUrl
        ? undefined
        : batch.items.find((entry) => entry.videoUrl)
      : batch.items.find((entry) => entry.index === itemIndex);
  const videoUrl = item ? item.videoUrl : batch.videoUrl;
  const seek = (seconds: number) => {
    if (videoRef.current && Number.isFinite(seconds)) videoRef.current.currentTime = Math.max(0, seconds);
  };
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <div className="flex flex-wrap gap-8">
        {batch.videoUrl && (
          <ReviewButton
            pressed={itemIndex === null}
            onClick={() => {
              setItemIndex(null);
              setMediaError(false);
            }}
          >
            <Trans>Watch the compilation</Trans>
          </ReviewButton>
        )}
        {batch.items.map((entry) => {
          const number = entry.index;
          const round = entry.request.roundNumber;
          return (
            <ReviewButton
              key={entry.index}
              disabled={!entry.videoUrl}
              pressed={itemIndex === entry.index}
              onClick={() => {
                setItemIndex(entry.index);
                setMediaError(false);
              }}
            >
              {number} · {entry.mapName} · {t`Round ${round}`} · {statuses[entry.status]}
            </ReviewButton>
          );
        })}
      </div>
      {videoUrl && (
        <video
          key={videoUrl}
          ref={videoRef}
          src={videoUrl}
          controls={true}
          preload="metadata"
          className="aspect-video w-full rounded-8 bg-black"
          onError={() => setMediaError(true)}
        />
      )}
      {mediaError && (
        <p role="alert">
          <Trans>This saved video could not be played. Check that its local file still exists.</Trans>
        </p>
      )}
      <p className="text-caption text-gray-600">
        <Trans>
          Each event shows your POV first, then the verified opponent when included. Each camera stops before that
          player dies; no unrelated spectator footage is added.
        </Trans>
      </p>
      {(item ? [item] : batch.items).map((entry) => {
        const number = entry.index;
        return (
          <div key={entry.index} className="flex flex-wrap gap-8 text-caption text-gray-700">
            <span>
              {number} · {entry.mapName}
            </span>
            {entry.segments.map((segment) => (
              <button
                key={segment.index}
                type="button"
                disabled={segment.offsetSeconds === undefined || !videoUrl}
                onClick={() => seek((item ? 0 : (entry.offsetSeconds ?? 0)) + (segment.offsetSeconds ?? 0))}
                className="rounded-4 bg-gray-200 px-8 py-4 hover:bg-gray-300 disabled:opacity-50"
              >
                {segment.perspective === 'player' ? t`Your POV` : t`Opponent POV`}
                {segment.truncatedAtDeath && (
                  <>
                    {' '}
                    · <Trans>Stops at death</Trans>
                  </>
                )}
              </button>
            ))}
            {entry.opponentUnavailable && (
              <span>
                <Trans>No verified opponent view is available for this event.</Trans>
              </span>
            )}
          </div>
        );
      })}
      {item?.videoUrl ? (
        <VideoAiReviewPanel
          key={`${batch.id}:${item.index}`}
          source={{ kind: 'batch', id: batch.id, itemIndex: item.index }}
          onConfigure={() => openSettings(SettingsCategory.Ai)}
          onSeek={seek}
        />
      ) : batch.videoUrl ? (
        <p className="text-caption text-gray-600">
          <Trans>Choose one event above to preview its key frames and request a focused AI video review.</Trans>
        </p>
      ) : null}
    </div>
  );
}
