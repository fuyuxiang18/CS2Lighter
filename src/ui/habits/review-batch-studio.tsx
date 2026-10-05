import React, { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReviewBatch, ReviewBatchInspection, ReviewBattleRequest } from 'csdm/common/types/review-batch';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { ReviewButton } from './review-button';
import { ReviewBatchViewer } from './review-batch-viewer';
import { isReviewRecordingActive, useReviewClipMessages } from './use-review-clip-messages';

function mergeBatch(batches: ReviewBatch[], batch: ReviewBatch) {
  const previous = batches.find((entry) => entry.id === batch.id);
  if (previous && previous.updatedAt > batch.updatedAt) return batches;
  return [...batches.filter((entry) => entry.id !== batch.id), batch].toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

function matchesEvent(request: ReviewBattleRequest, candidate: ReviewBattleRequest) {
  return (
    request.checksum === candidate.checksum &&
    request.steamId === candidate.steamId &&
    request.roundNumber === candidate.roundNumber &&
    request.startTick === candidate.startTick &&
    request.endTick === candidate.endTick
  );
}

export function ReviewBatchStudio({ requests, steamId }: { requests: ReviewBattleRequest[]; steamId: string }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const { openSettings } = useSettingsOverlay();
  const { statuses, issueText } = useReviewClipMessages();
  const [includeOpponent, setIncludeOpponent] = useState(true);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialItemIndex, setInitialItemIndex] = useState<number | undefined>();
  const [inspection, setInspection] = useState<ReviewBatchInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const initialRequests = useRef(requests);
  const selectedCount = requests.length;
  const demoCount = new Set(requests.map((request) => request.checksum)).size;
  const batch = batches.find((entry) => entry.id === selectedId);
  const completedSegments = batch?.completedSegments ?? 0;
  const totalSegments = batch?.totalSegments ?? 0;
  const completedDemos = batch?.completedDemos ?? 0;
  const batchDemoCount = batch?.demoCount ?? 0;
  const launchCount = batch?.launchCount ?? 0;
  const currentDemo = batch?.currentDemo;
  const currentItem = batch?.items.find((item) =>
    item.segments.some((segment) => segment.index === batch.currentSegment),
  );
  const currentSegment = currentItem?.segments.find((segment) => segment.index === batch?.currentSegment);
  const currentEvent = currentItem?.index;
  const recordingBusy = batches.some((entry) => isReviewRecordingActive(entry.status));
  useEffect(() => {
    let disposed = false;
    const update = (next: ReviewBatch) => {
      if (!disposed) setBatches((previous) => mergeBatch(previous, next));
    };
    client.on(ServerPushMessageName.ReviewBatchUpdated, update);
    void client
      .send({ name: RendererClientMessageName.ListReviewBatches })
      .then((saved) => {
        if (disposed) return;
        setBatches((previous) => saved.reduce(mergeBatch, previous));
        const active = saved.find(
          (entry) =>
            isReviewRecordingActive(entry.status) && entry.items.some((item) => item.request.steamId === steamId),
        );
        const initial = initialRequests.current;
        const cached =
          initial.length === 1
            ? saved.find((entry) =>
                entry.items.some(
                  (item) => item.status === 'ready' && item.videoUrl && matchesEvent(initial[0], item.request),
                ),
              )
            : undefined;
        const selected = cached ?? active;
        if (selected) {
          setSelectedId(selected.id);
          setInitialItemIndex(cached?.items.find((item) => matchesEvent(initial[0], item.request))?.index);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      client.off(ServerPushMessageName.ReviewBatchUpdated, update);
    };
  }, [client, steamId]);
  const inspect = async (id: string) => {
    setSelectedId(id);
    setInitialItemIndex(undefined);
    setBusy(true);
    setFailed(false);
    try {
      const result = await client.send({ name: RendererClientMessageName.GetReviewBatch, payload: { id } });
      if (!result) throw new Error('Recording batch is no longer available');
      setInspection(result);
      setBatches((previous) => mergeBatch(previous, result.batch));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const generate = async (clips = requests, opponent = includeOpponent) => {
    if (!clips.length || clips.length > 20) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await client.send({
        name: RendererClientMessageName.GenerateReviewBatch,
        payload: { clips, includeOpponent: opponent },
      });
      setInspection(result);
      setBatches((previous) => mergeBatch(previous, result.batch));
      setSelectedId(result.batch.id);
      setInitialItemIndex(clips.length === 1 ? result.batch.items[0]?.index : undefined);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!batch) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await client.send({ name: RendererClientMessageName.CancelReviewBatch, payload: { id: batch.id } });
      if (next) setBatches((previous) => mergeBatch(previous, next));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const reasons =
    batch && batch.status !== 'ready' && !isReviewRecordingActive(batch.status)
      ? [
          ...new Set([
            ...(batch.issue ? [batch.issue] : []),
            ...(inspection?.batch.id === batch.id ? inspection.requirements.missingReasons : []),
          ]),
        ]
      : [];
  const recent = batches.filter((entry) => entry.items.some((item) => item.request.steamId === steamId)).slice(0, 10);
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-accent-muted bg-gray-75 p-16">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex flex-col gap-8">
          <h3 className="text-body-strong">
            <Trans>Edited review videos</Trans>
          </h3>
          <p className="text-gray-700">
            <Trans>
              {selectedCount} selected events · {demoCount} matches
            </Trans>
          </p>
          <p className="text-caption text-gray-600">
            <Trans>
              One game start per demo. Record selected events together, then watch the saved videos instantly.
            </Trans>
          </p>
        </div>
        <ReviewButton onClick={() => openSettings(SettingsCategory.Video)}>
          <Trans>Recording setup</Trans>
        </ReviewButton>
      </div>
      <Checkbox
        isChecked={includeOpponent}
        isDisabled={busy || recordingBusy}
        onChange={(event) => setIncludeOpponent(event.target.checked)}
        label={<Trans>Include the opponent POV after each of my encounters</Trans>}
      />
      <p className="text-caption text-gray-600">
        <Trans>
          More perspectives take more recording time. Start with a few important events; cached videos do not need
          another game launch.
        </Trans>
      </p>
      <div className="flex flex-wrap gap-8">
        <ReviewButton
          primary={true}
          disabled={busy || loading || recordingBusy || selectedCount === 0 || selectedCount > 20}
          onClick={() => void generate()}
        >
          <Trans>Record selected events</Trans>
        </ReviewButton>
        {batch && isReviewRecordingActive(batch.status) && (
          <ReviewButton disabled={busy} onClick={() => void cancel()}>
            <Trans>Cancel this recording batch</Trans>
          </ReviewButton>
        )}
        {batch && ['failed', 'canceled'].includes(batch.status) && (
          <ReviewButton
            disabled={busy || recordingBusy}
            onClick={() =>
              void generate(
                batch.items.map((item) => item.request),
                batch.includeOpponent,
              )
            }
          >
            <Trans>Retry this batch</Trans>
          </ReviewButton>
        )}
      </div>
      {selectedCount === 0 && (
        <p className="text-caption text-gray-600">
          <Trans>Select up to 20 combat events below. Your selection stays when changing pages.</Trans>
        </p>
      )}
      {batch && (
        <div className="flex min-w-0 flex-col gap-12 rounded-8 border border-gray-300 p-16">
          <p role="status" className="text-body-strong">
            {statuses[batch.status]}
          </p>
          {isReviewRecordingActive(batch.status) && (
            <progress
              className="w-full"
              max={Math.max(1, batch.totalSegments)}
              value={batch.completedSegments}
              aria-label={t`Recording batch progress`}
            />
          )}
          <p className="text-caption text-gray-700">
            <Trans>
              {completedSegments} / {totalSegments} camera segments · {completedDemos} / {batchDemoCount} demos ·{' '}
              {launchCount} game starts
            </Trans>
          </p>
          {isReviewRecordingActive(batch.status) && currentDemo !== undefined && (
            <p className="text-caption text-gray-700" role="status">
              {t`Processing demo ${currentDemo} of ${batchDemoCount}`}
              {currentEvent !== undefined && currentSegment && (
                <>
                  {' · '}
                  {t`Event ${currentEvent}`}
                  {' · '}
                  {currentSegment.perspective === 'player' ? t`Your POV` : t`Opponent POV`}
                </>
              )}
            </p>
          )}
          {reasons.map((reason) => (
            <p key={reason} role="alert" className="text-caption text-gray-700">
              {issueText(reason)}
            </p>
          ))}
          {reasons.includes('cs2-missing') && (
            <ReviewButton onClick={() => openSettings(SettingsCategory.Playback)}>
              <Trans>Game setup</Trans>
            </ReviewButton>
          )}
          {batch.items
            .filter((item) => item.issue)
            .map((item) => {
              const eventNumber = item.index;
              return (
                <details key={item.index} className="text-caption text-gray-700">
                  <summary className="cursor-pointer">
                    {t`Event ${eventNumber}`} · {issueText(item.issue!)}
                  </summary>
                  {item.errorDetail && <p className="mt-8 break-all">{item.errorDetail}</p>}
                </details>
              );
            })}
          {batch.items.some((item) => item.videoUrl) && (
            <ReviewBatchViewer
              key={`${batch.id}:${initialItemIndex ?? 'all'}`}
              batch={batch}
              initialItemIndex={initialItemIndex}
            />
          )}
        </div>
      )}
      {recent.length > 0 && (
        <details className="min-w-0">
          <summary className="cursor-pointer text-caption text-gray-700">
            <Trans>Recent recording batches</Trans>
          </summary>
          <div className="mt-12 flex flex-wrap gap-8">
            {recent.map((entry) => {
              const count = entry.items.length;
              return (
                <ReviewButton
                  key={entry.id}
                  disabled={busy}
                  pressed={entry.id === selectedId}
                  onClick={() => void inspect(entry.id)}
                >
                  {formatDate(entry.createdAt)} · {t`${count} events`} · {statuses[entry.status]}
                </ReviewButton>
              );
            })}
          </div>
        </details>
      )}
      {failed && (
        <p role="alert" className="text-red-500">
          <Trans>Could not load or start this recording batch. Check the demo and recording setup, then retry.</Trans>
        </p>
      )}
    </section>
  );
}
