import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReviewDuel, ReviewDuelsPage, ReviewDuelsPayload } from 'csdm/common/types/review-duels';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { RoutePath, buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { ReviewButton } from './review-button';
import { ReviewClipViewer } from './review-clip-viewer';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import type { RecordingQueue, RecordingQueueItem } from 'csdm/common/types/recording-queue';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import type { ReviewBattleRequest } from 'csdm/common/types/review-batch';

function battleRequest(event: ReviewDuel): ReviewBattleRequest {
  return {
    checksum: event.checksum,
    steamId: event.steamId,
    roundNumber: event.roundNumber,
    startTick: event.startTick,
    endTick: event.endTick,
    eventTick: event.eventTick,
    opponentSteamId: event.opponentSteamId,
  };
}

export function ReviewDuels({ scope }: { scope: Omit<ReviewDuelsPayload, 'filter' | 'page'> }) {
  return <DuelList key={JSON.stringify(scope)} scope={scope} />;
}

function DuelList({ scope }: { scope: Omit<ReviewDuelsPayload, 'filter' | 'page'> }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const [filter, setFilter] = useState<ReviewDuelsPayload['filter']>('all');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ReviewDuelsPage | null>(null);
  const [selected, setSelected] = useState<ReviewDuel | null>(null);
  const [recordingQueue, setRecordingQueue] = useState<RecordingQueue>();
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueFailed, setQueueFailed] = useState(false);
  const playerRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    let disposed = false;
    const update = (next: RecordingQueue) => {
      if (!disposed)
        setRecordingQueue((previous) => (previous && previous.updatedAt > next.updatedAt ? previous : next));
    };
    client.on(ServerPushMessageName.RecordingQueueUpdated, update);
    void client
      .send({ name: RendererClientMessageName.GetRecordingQueue })
      .then(update)
      .catch(() => {
        if (!disposed) setQueueFailed(true);
      });
    return () => {
      disposed = true;
      client.off(ServerPushMessageName.RecordingQueueUpdated, update);
    };
  }, [client]);
  const queueItem = (event: ReviewDuel): RecordingQueueItem | undefined =>
    recordingQueue?.items.find(
      (item) =>
        item.includeOpponent &&
        item.request.checksum === event.checksum &&
        item.request.steamId === event.steamId &&
        item.request.roundNumber === event.roundNumber &&
        item.request.startTick === event.startTick &&
        item.request.endTick === event.endTick &&
        (!event.opponentSteamId || item.request.opponentSteamId === event.opponentSteamId),
    );
  const addEvents = async (events: ReviewDuel[]) => {
    setQueueBusy(true);
    setQueueFailed(false);
    try {
      const retryIds = events
        .map(queueItem)
        .filter(
          (item): item is RecordingQueueItem => item !== undefined && ['failed', 'canceled'].includes(item.status),
        )
        .map((item) => item.id);
      let next = await client.send({
        name: RendererClientMessageName.AddToRecordingQueue,
        payload: { clips: events.map(battleRequest), includeOpponent: true },
      });
      if (retryIds.length)
        next = await client.send({
          name: RendererClientMessageName.ControlRecordingQueue,
          payload: { action: 'retry', ids: retryIds },
        });
      setRecordingQueue(next);
    } catch {
      setQueueFailed(true);
    } finally {
      setQueueBusy(false);
    }
  };
  const toggleQueue = async (event: ReviewDuel) => {
    const item = queueItem(event);
    if (!item || ['failed', 'canceled'].includes(item.status)) return addEvents([event]);
    if (item.status !== 'pending') return;
    setQueueBusy(true);
    setQueueFailed(false);
    try {
      setRecordingQueue(
        await client.send({
          name: RendererClientMessageName.ControlRecordingQueue,
          payload: { action: 'remove', ids: [item.id] },
        }),
      );
    } catch {
      setQueueFailed(true);
    } finally {
      setQueueBusy(false);
    }
  };

  useEffect(() => {
    if (selected) playerRef.current?.scrollIntoView({ block: 'start' });
  }, [selected]);
  useEffect(() => {
    let canceled = false;
    void client
      .send({ name: RendererClientMessageName.FetchReviewDuels, payload: { ...JSON.parse(scopeKey), filter, page } })
      .then((result) => {
        if (!canceled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [client, scopeKey, filter, page, revision]);
  const chooseFilter = (next: ReviewDuelsPayload['filter']) => {
    if (filter === next && page === 0) return;
    setLoading(true);
    setFailed(false);
    setSelected(null);
    setFilter(next);
    setPage(0);
  };
  const choosePage = (next: number) => {
    setLoading(true);
    setFailed(false);
    setSelected(null);
    setPage(next);
  };
  const selectedRound = selected?.roundNumber;
  const opportunities = (data?.openingKills ?? 0) + (data?.openingDeaths ?? 0);
  const rate = opportunities ? `${((data!.openingKills / opportunities) * 100).toFixed(1)}%` : '—';
  const total = data?.total ?? 0;
  const pageNumber = (data?.page ?? 0) + 1;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 20)));
  return (
    <div className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap items-start justify-between gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
        <div className="flex min-w-0 flex-col gap-8">
          <h2 className="text-subtitle">
            <Trans>Your combat events</Trans>
          </h2>
          <p className="text-gray-700">
            <Trans>Choose an event to watch the seconds before and after it from your own POV.</Trans>
          </p>
        </div>
        <button
          onClick={() => chooseFilter('opening')}
          className="shrink-0 rounded-12 border border-accent-muted bg-accent-soft p-16 text-left"
        >
          <span className="block text-caption text-gray-700">
            <Trans>Opening duel success</Trans>
          </span>
          <strong className="block text-display text-accent">{loading ? '…' : rate}</strong>
          <span className="text-caption text-gray-700">
            {data?.openingKills ?? 0} / {opportunities} · <Trans>View every opening</Trans>
          </span>
        </button>
      </div>
      <nav className="flex flex-wrap gap-8" aria-label={t`Combat event filters`}>
        {(
          [
            { value: 'all', label: t`All combat` },
            { value: 'opening', label: t`Opening duels` },
            { value: 'kills', label: t`Kills` },
            { value: 'deaths', label: t`Deaths` },
            { value: 'damage', label: t`Damage without a kill` },
          ] as const
        ).map((item) => (
          <ReviewButton
            key={item.value}
            pressed={filter === item.value}
            primary={filter === item.value}
            onClick={() => chooseFilter(item.value)}
          >
            {item.label}
          </ReviewButton>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-8">
        <ReviewButton
          disabled={loading || queueBusy || !recordingQueue || !data?.events.length}
          onClick={() => void addEvents((data?.events ?? []).slice(0, 20))}
        >
          <Trans>Add this page to recording queue</Trans>
        </ReviewButton>
        <Link className="text-accent" to={RoutePath.RecordingQueue}>
          <Trans>Open recording queue</Trans>
        </Link>
        {queueFailed && (
          <p role="alert" className="text-red-500">
            <Trans>Could not update the recording queue.</Trans>
          </p>
        )}
      </div>
      {loading ? (
        <p role="status">
          <Trans>Loading combat events…</Trans>
        </p>
      ) : failed ? (
        <div role="alert">
          <p>
            <Trans>Combat events could not be loaded.</Trans>
          </p>
          <ReviewButton
            onClick={() => {
              setLoading(true);
              setFailed(false);
              setRevision(revision + 1);
            }}
          >
            <Trans>Retry</Trans>
          </ReviewButton>
        </div>
      ) : (
        <>
          {selected && (
            <section
              ref={playerRef}
              className="flex flex-col gap-12 rounded-12 border border-gray-300 bg-gray-100 p-16"
            >
              <div className="flex flex-wrap items-center justify-between gap-8">
                <p className="text-body-strong">
                  {selected.mapName} · {t`Round ${selectedRound}`} · {selected.opponent}
                </p>
                <ReviewButton onClick={() => setSelected(null)}>
                  <Trans>Close POV</Trans>
                </ReviewButton>
              </div>
              <ReviewClipViewer key={selected.id} request={battleRequest(selected)} />
            </section>
          )}
          <p className="text-caption text-gray-600">
            <Trans>
              {total} matching events · page {pageNumber} of {pages}
            </Trans>
          </p>
          <div className="flex flex-col gap-8">
            {data?.events.map((event) => {
              const { roundNumber, damageGiven, damageTaken } = event;
              const queued = queueItem(event);
              return (
                <article
                  key={event.id}
                  className={`flex flex-wrap items-center justify-between gap-12 rounded-12 border bg-gray-100 p-16 ${selected?.id === event.id ? 'border-accent-muted' : 'border-gray-300'}`}
                >
                  <div className="flex min-w-0 flex-col gap-4">
                    <p className="text-body-strong">
                      {event.kind === 'kill' ? t`Kill` : event.kind === 'death' ? t`Death` : t`Damage exchange`} ·{' '}
                      {event.opponent || t`Opponent`}{' '}
                      {event.opening && (
                        <span className="text-accent">
                          · <Trans>Opening duel</Trans>
                        </span>
                      )}
                    </p>
                    <p className="text-caption text-gray-700">
                      {event.mapName} · {t`Round ${roundNumber}`} · {event.side === TeamNumber.CT ? 'CT' : 'T'} ·{' '}
                      {event.weapon}{' '}
                      {event.headshot && (
                        <span>
                          · <Trans>Headshot</Trans>
                        </span>
                      )}
                    </p>
                    <p className="text-caption text-gray-600">
                      {formatDate(event.date)} ·{' '}
                      <Trans>
                        Dealt {damageGiven} / taken {damageTaken}
                      </Trans>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-12">
                    <Checkbox
                      label={
                        queued?.status === 'ready'
                          ? t`Video saved`
                          : queued?.status === 'active'
                            ? t`In this session`
                            : t`Add to recording queue`
                      }
                      isChecked={Boolean(queued && ['pending', 'active', 'ready'].includes(queued.status))}
                      isDisabled={
                        queueBusy || !recordingQueue || queued?.status === 'active' || queued?.status === 'ready'
                      }
                      onChange={() => void toggleQueue(event)}
                    />
                    <ReviewButton primary={true} onClick={() => setSelected(event)}>
                      <Trans>Watch real POV</Trans>
                    </ReviewButton>
                    <Link
                      className="text-caption text-gray-600"
                      to={`${buildMatch2dViewerRoundPath(event.checksum, event.roundNumber)}?${new URLSearchParams({ player: event.steamId, tick: String(event.startTick) })}`}
                    >
                      <Trans>2D context</Trans>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          {total === 0 && (
            <p>
              <Trans>No combat events match this selection.</Trans>
            </p>
          )}
          <div className="flex gap-8">
            <ReviewButton disabled={pageNumber <= 1} onClick={() => choosePage(Math.max(0, pageNumber - 2))}>
              <Trans>Previous</Trans>
            </ReviewButton>
            <ReviewButton disabled={pageNumber >= pages} onClick={() => choosePage(pageNumber)}>
              <Trans>Next</Trans>
            </ReviewButton>
          </div>
        </>
      )}
    </div>
  );
}
