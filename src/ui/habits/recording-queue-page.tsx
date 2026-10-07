import React, { useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ControlRecordingQueue, RecordingQueue, RecordingQueueItem } from 'csdm/common/types/recording-queue';
import type { ReviewBatch } from 'csdm/common/types/review-batch';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import { ReviewButton } from './review-button';
import { ReviewBatchViewer } from './review-batch-viewer';
import { useReviewClipMessages } from './use-review-clip-messages';

export function RecordingQueuePage() {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const { openSettings } = useSettingsOverlay();
  const { statuses, issueText } = useReviewClipMessages();
  const [queue, setQueue] = useState<RecordingQueue>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState<{ batch: ReviewBatch; index?: number }>();
  const [history, setHistory] = useState<ReviewBatch[]>([]);
  useEffect(() => {
    let disposed = false;
    const update = (next: RecordingQueue) => {
      if (!disposed) setQueue(next);
    };
    client.on(ServerPushMessageName.RecordingQueueUpdated, update);
    void client
      .send({ name: RendererClientMessageName.GetRecordingQueue })
      .then(update)
      .catch(() => {
        if (!disposed) setError(true);
      });
    void client
      .send({ name: RendererClientMessageName.ListReviewBatches })
      .then((batches) => {
        if (!disposed) setHistory(batches);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      client.off(ServerPushMessageName.RecordingQueueUpdated, update);
    };
  }, [client]);
  const control = async (payload: ControlRecordingQueue) => {
    setBusy(true);
    setError(false);
    try {
      setQueue(await client.send({ name: RendererClientMessageName.ControlRecordingQueue, payload }));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string, index?: number) => {
    setBusy(true);
    setError(false);
    try {
      const result = await client.send({ name: RendererClientMessageName.GetReviewBatch, payload: { id } });
      if (!result) throw new Error('Recording unavailable');
      setViewing({ batch: result.batch, index });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const items = queue?.items ?? [];
  const pending = items.filter((item) => item.status === 'pending');
  const selection = items.filter((item) => selected.includes(item.id));
  const pendingIds = selection.filter((item) => item.status === 'pending').map((item) => item.id);
  const failedIds = selection.filter((item) => ['failed', 'canceled'].includes(item.status)).map((item) => item.id);
  const removableIds = selection.filter((item) => item.status !== 'active').map((item) => item.id);
  const demoCount = new Set(selection.filter((item) => item.status === 'pending').map((item) => item.request.checksum))
    .size;
  const selectedCount = pendingIds.length;
  const batch = queue?.batch;
  const activeItem = batch?.items.find((item) =>
    item.segments.some((segment) => segment.index === batch.currentSegment),
  );
  const activeSegment = activeItem?.segments.find((segment) => segment.index === batch?.currentSegment);
  const activeRound = activeItem?.request.roundNumber;
  const completed = batch?.completedSegments ?? 0;
  const total = batch?.totalSegments ?? 0;
  const launchCount = batch?.launchCount ?? 0;
  const eventLabels = { kill: t`Kill`, death: t`Death`, damage: t`Damage exchange`, range: t`Evidence clip` };
  const status = (item: RecordingQueueItem) =>
    item.status === 'pending'
      ? t`Waiting to record`
      : item.status === 'active'
        ? t`In this session`
        : statuses[item.status];
  return (
    <main className="flex h-full min-w-0 flex-col gap-16 overflow-y-auto p-24">
      <header className="flex flex-wrap items-start justify-between gap-16">
        <div className="flex flex-col gap-8">
          <h1 className="text-heading font-bold">
            <Trans>Recording queue</Trans>
          </h1>
          <p className="text-gray-700">
            <Trans>
              Select encounters, then start one recording session. Waiting items stay here after restarting the app.
            </Trans>
          </p>
        </div>
        <ReviewButton onClick={() => openSettings(SettingsCategory.Video)}>
          <Trans>Recording setup</Trans>
        </ReviewButton>
      </header>
      <section className="flex flex-col gap-12 rounded-12 border border-gray-300 bg-gray-75 p-16">
        <div className="flex flex-wrap items-center gap-8">
          <ReviewButton
            disabled={busy || !pending.length}
            onClick={() => setSelected(pending.slice(0, 20).map((item) => item.id))}
          >
            <Trans>Select up to 20 waiting events</Trans>
          </ReviewButton>
          <ReviewButton disabled={busy || !selected.length} onClick={() => setSelected([])}>
            <Trans>Clear selection</Trans>
          </ReviewButton>
          <ReviewButton
            primary={true}
            disabled={busy || queue?.running || !pendingIds.length || pendingIds.length > 20}
            onClick={() => void control({ action: 'start', ids: pendingIds })}
          >
            <Trans>Start selected recordings</Trans>
          </ReviewButton>
          <ReviewButton
            disabled={busy || !removableIds.length}
            onClick={() => void control({ action: 'remove', ids: removableIds })}
          >
            <Trans>Remove selected items</Trans>
          </ReviewButton>
          <ReviewButton
            disabled={busy || !failedIds.length}
            onClick={() => void control({ action: 'retry', ids: failedIds })}
          >
            <Trans>Return failed items to waiting</Trans>
          </ReviewButton>
        </div>
        <p className="text-caption text-gray-600">
          <Trans>
            {selectedCount} selected events · {demoCount} matches · one game session
          </Trans>
        </p>
        {queue?.running && (
          <div className="flex flex-wrap gap-8">
            <ReviewButton disabled={busy || queue.pauseRequested} onClick={() => void control({ action: 'pause' })}>
              <Trans>Pause after this encounter</Trans>
            </ReviewButton>
            <ReviewButton disabled={busy} onClick={() => void control({ action: 'cancel' })}>
              <Trans>Cancel current recording</Trans>
            </ReviewButton>
            {queue.pauseRequested && (
              <p role="status">
                <Trans>Stopping this session; remaining events stay in the queue.</Trans>
              </p>
            )}
          </div>
        )}
        {batch && (
          <div className="flex flex-col gap-8" role="status">
            <p>
              {statuses[batch.status]} ·{' '}
              <Trans>
                {completed} / {total} camera segments · {launchCount} game starts
              </Trans>
            </p>
            <progress
              className="w-full"
              max={Math.max(1, total)}
              value={completed}
              aria-label={t`Recording progress`}
            />
            {activeItem && (
              <p>
                {activeItem.mapName} · {t`Round ${activeRound}`} ·{' '}
                {activeSegment?.perspective === 'opponent' ? t`Opponent POV` : t`Your POV`}
              </p>
            )}
            {batch.issue && <p role="alert">{issueText(batch.issue)}</p>}
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="text-red-500">
          <Trans>Could not update the recording queue. Check the demo and recording setup, then retry.</Trans>
        </p>
      )}
      {queue && !items.length && (
        <p className="p-24 text-gray-600">
          <Trans>
            Add encounters from personal review, map evidence, or the combat list. Adding an item does not launch CS2.
          </Trans>
        </p>
      )}
      <div className="flex flex-col gap-12">
        {items.map((item) => {
          const round = item.request.roundNumber;
          const eventTick = item.request.eventTick;
          return (
            <article
              key={item.id}
              className="flex flex-wrap items-start gap-12 rounded-12 border border-gray-300 bg-gray-75 p-16"
            >
              <Checkbox
                isChecked={selected.includes(item.id)}
                isDisabled={busy || item.status === 'active'}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                  )
                }
                label={
                  <>
                    {item.mapName} · <Trans>Round {round}</Trans>
                  </>
                }
              />
              <div className="flex min-w-0 flex-1 flex-col gap-8">
                <p className="text-body-strong wrap-break-word">
                  {item.playerName}
                  {item.opponentName ? ` → ${item.opponentName}` : ''}
                </p>
                <p className="text-caption wrap-break-word text-gray-600">{item.demoName}</p>
                <details className="text-caption text-gray-600">
                  <summary className="cursor-pointer">
                    <Trans>Source details</Trans>
                  </summary>
                  <p>
                    {item.request.checksum}
                    {eventTick !== undefined && (
                      <>
                        {' '}
                        · <Trans>Tick {eventTick}</Trans>
                      </>
                    )}
                  </p>
                </details>
                <p className="text-caption text-gray-700">
                  {item.perspectives.includes('opponent')
                    ? t`Your POV → opponent POV · same encounter`
                    : t`Your POV · opponent unavailable or not selected`}
                </p>
                <p className="text-caption text-gray-600">
                  {eventLabels[item.eventKind ?? 'range']}
                  {item.opening && (
                    <>
                      {' '}
                      · <Trans>Opening duel</Trans>
                    </>
                  )}
                </p>
                <p className="text-caption">
                  {status(item)}
                  {item.issue && <> · {issueText(item.issue)}</>}
                </p>
              </div>
              {item.status === 'ready' && item.batchId && (
                <ReviewButton onClick={() => void open(item.batchId!, item.batchItemIndex)}>
                  <Trans>Watch saved video</Trans>
                </ReviewButton>
              )}
            </article>
          );
        })}
      </div>
      {viewing && (
        <section className="rounded-12 border border-gray-300 p-16">
          <ReviewBatchViewer
            key={`${viewing.batch.id}:${viewing.index}`}
            batch={viewing.batch}
            initialItemIndex={viewing.index}
          />
        </section>
      )}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-gray-700">
            <Trans>Previously saved recording batches</Trans>
          </summary>
          <div className="mt-12 flex flex-wrap gap-8">
            {history.map((entry) => (
              <ReviewButton key={entry.id} onClick={() => void open(entry.id)}>
                {entry.items[0]?.mapName} · {entry.createdAt.slice(0, 10)} · {statuses[entry.status]}
              </ReviewButton>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}
