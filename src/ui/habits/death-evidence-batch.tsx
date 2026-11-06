import React, { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeathEvidenceState, InspectDeathEvidence } from 'csdm/common/types/death-evidence';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { ReviewButton } from './review-button';
import { deathBatchKey, deathBatchProgress, type DeathBatchItem } from './death-batch-progress';
import { DeathBatchTracker, loadDeathBatch, saveDeathBatch } from './death-batch-storage';

export function DeathEvidenceBatch({ records }: { records: DeathReviewRecord[] }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const [tracker] = useState(() => new DeathBatchTracker(loadDeathBatch()));
  const [items, setItems] = useState<DeathBatchItem[]>(() => tracker.snapshot());
  const lifecycle = useRef(0);
  const inFlight = useRef(false);
  const [sending, setSending] = useState(() => tracker.snapshot().length > 0);
  const [requestFailed, setRequestFailed] = useState(false);
  const selected = records.length;
  const progress = deathBatchProgress(items);
  const { completed, failed, canceled, settled, total } = progress;

  useEffect(() => {
    const generation = ++lifecycle.current;
    const publish = () => {
      const snapshot = tracker.snapshot();
      saveDeathBatch(snapshot);
      setItems(snapshot);
    };
    const update = (state: DeathEvidenceState) => {
      if (generation === lifecycle.current && tracker.push(state)) publish();
    };
    client.on(ServerPushMessageName.DeathEvidenceUpdated, update);
    const restored = tracker.snapshot();
    if (restored.length) {
      inFlight.current = true;
      void Promise.all(
        restored.map(async (item) => {
          const token = tracker.token(deathBatchKey(item));
          try {
            const state = await client.send({
              name: RendererClientMessageName.InspectDeathEvidence,
              payload: { checksum: item.checksum, steamId: item.steamId, deathId: item.deathId, action: 'read' },
            });
            if (generation === lifecycle.current && tracker.reply(state, token, true)) publish();
          } catch (error) {
            logger.error(error);
            if (generation === lifecycle.current) {
              setRequestFailed(true);
              if (tracker.reply({ ...item, status: 'error' }, token)) publish();
            }
          }
        }),
      ).finally(() => {
        if (generation !== lifecycle.current) return;
        inFlight.current = false;
        setSending(false);
      });
    }
    return () => {
      lifecycle.current = generation + 1;
      inFlight.current = false;
      client.off(ServerPushMessageName.DeathEvidenceUpdated, update);
    };
  }, [client, tracker]);

  const control = async (action: 'analyze' | 'resume' | 'cancel') => {
    // A ref closes the gap before React commits disabled state after a click.
    if (inFlight.current || (action !== 'cancel' && deathBatchProgress(tracker.snapshot()).active)) return;
    if (action === 'analyze' && !records.length) return;
    inFlight.current = true;
    const generation = lifecycle.current;
    setSending(true);
    setRequestFailed(false);
    const publish = () => {
      const snapshot = tracker.snapshot();
      saveDeathBatch(snapshot);
      setItems(snapshot);
    };
    if (action === 'analyze') {
      tracker.replace(
        records.slice(0, 32).map((record) => ({
          checksum: record.checksum,
          steamId: record.steamId,
          deathId: record.id,
          status: 'queued',
          completedTicks: 0,
          totalTicks: 0,
        })),
      );
      publish();
    } else if (action === 'resume') {
      tracker.replace(
        tracker.snapshot().map((item) =>
          item.status === 'completed'
            ? item
            : {
                ...item,
                status: 'queued',
                completedTicks: 0,
                totalTicks: 0,
              },
        ),
      );
      publish();
    }
    const requests = tracker
      .snapshot()
      .filter((item) =>
        action === 'cancel' ? ['queued', 'running', 'idle'].includes(item.status) : item.status !== 'completed',
      );
    await Promise.all(
      requests.map(async (item) => {
        const token = tracker.token(deathBatchKey(item));
        const payload: InspectDeathEvidence = {
          checksum: item.checksum,
          steamId: item.steamId,
          deathId: item.deathId,
          action: action === 'cancel' ? 'cancel' : 'analyze',
        };
        try {
          const result = await client.send({ name: RendererClientMessageName.InspectDeathEvidence, payload });
          if (generation === lifecycle.current && tracker.reply(result, token, action === 'cancel')) publish();
        } catch (error) {
          logger.error(error);
          if (generation !== lifecycle.current) return;
          setRequestFailed(true);
          if (action !== 'cancel' && tracker.reply({ ...item, status: 'error' }, token)) publish();
        }
      }),
    );
    if (generation === lifecycle.current) {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-12 rounded-12 border border-gray-300 bg-gray-100 p-16">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex flex-col gap-4">
          <h3 className="text-body-strong">
            <Trans>Batch operation review</Trans>
          </h3>
          <span className="text-caption text-gray-700">
            <Trans>{selected} selected · saved evidence is reused</Trans>
          </span>
        </div>
        <div className="flex flex-wrap gap-8">
          {progress.active ? (
            <ReviewButton disabled={sending} onClick={() => void control('cancel')}>
              <Trans>Pause this batch</Trans>
            </ReviewButton>
          ) : (
            <>
              {failed + canceled > 0 && (
                <ReviewButton disabled={sending} onClick={() => void control('resume')}>
                  <Trans>Resume previous batch</Trans>
                </ReviewButton>
              )}
              <ReviewButton primary={true} disabled={sending || selected === 0} onClick={() => void control('analyze')}>
                <Trans>Analyze selected deaths</Trans>
              </ReviewButton>
            </>
          )}
        </div>
      </div>
      {total > 0 && (
        <div role="status" className="flex flex-col gap-8">
          <div className="flex flex-wrap justify-between gap-8 text-caption">
            <span>
              <Trans>
                {settled} / {total} deaths processed
              </Trans>
            </span>
            <span>
              <Trans>
                {completed} saved · {failed} failed · {canceled} paused
              </Trans>
            </span>
          </div>
          <progress className="w-full" aria-label={t`Batch evidence progress`} max={total} value={progress.fraction} />
        </div>
      )}
      {requestFailed && (
        <p role="alert" className="text-body text-red-500">
          <Trans>Some requests failed. Retry the batch to reuse completed results.</Trans>
        </p>
      )}
    </section>
  );
}
