import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { DEATH_RULES } from 'csdm/common/death-review/death-rules';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  DeathKind,
  DeathReviewPage,
  DeathReviewProgress,
  DeathReviewRecord,
  DeathReviewScope,
  FetchDeathReviewPage,
} from 'csdm/common/types/death-review';
import type { RecordingQueue, RecordingQueueItem } from 'csdm/common/types/recording-queue';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Checkbox } from 'csdm/ui/components/inputs/checkbox';
import { Select } from 'csdm/ui/components/inputs/select';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RoutePath } from 'csdm/ui/routes-paths';
import { DeathReviewDetail, canReplayDeath } from './death-review-detail';
import { ReviewButton } from './review-button';
import { useDeathReviewCopy } from './use-death-review-copy';

export function ReviewDeaths({ scope }: { scope: DeathReviewScope }) {
  return <DeathList key={JSON.stringify(scope)} scope={scope} />;
}

function DeathList({ scope }: { scope: DeathReviewScope }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const copy = useDeathReviewCopy();
  const [filter, setFilter] = useState<NonNullable<FetchDeathReviewPage['filter']>>('all');
  const [findingCode, setFindingCode] = useState('all');
  const [kind, setKind] = useState<DeathKind | 'all'>('all');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DeathReviewPage | null>(null);
  const [progress, setProgress] = useState<DeathReviewProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queue, setQueue] = useState<RecordingQueue | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueFailed, setQueueFailed] = useState(false);
  const progressId = useRef<string | null>(null);
  const lastTerminalProgress = useRef<string | null>(null);
  const pushSequence = useRef(0);
  const progressPushes = useRef(new Map<string, { sequence: number; progress: DeathReviewProgress }>());
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    const onProgress = (next: DeathReviewProgress) => {
      if (next.steamId !== scope.steamId) return;
      progressPushes.current.set(next.id, { sequence: ++pushSequence.current, progress: next });
      if (progressPushes.current.size > 20) progressPushes.current.delete(progressPushes.current.keys().next().value!);
      if (next.id !== progressId.current) return;
      setProgress(next);
      if (next.status === 'running') lastTerminalProgress.current = null;
      else {
        const signature = JSON.stringify([next.id, next.status, next.completed, next.failed]);
        if (lastTerminalProgress.current !== signature) {
          lastTerminalProgress.current = signature;
          setLoading(true);
          setFailed(false);
          setRevision((value) => value + 1);
        }
      }
    };
    client.on(ServerPushMessageName.DeathReviewProgressUpdated, onProgress);
    return () => client.off(ServerPushMessageName.DeathReviewProgressUpdated, onProgress);
  }, [client, scope.steamId]);

  useEffect(() => {
    let disposed = false;
    const requestSequence = pushSequence.current;
    void client
      .send({
        name: RendererClientMessageName.FetchDeathReviewPage,
        payload: {
          ...JSON.parse(scopeKey),
          page,
          filter,
          ...(findingCode === 'all' ? {} : { findingCode }),
          ...(kind === 'all' ? {} : { kind }),
        },
      })
      .then((result) => {
        if (disposed) return;
        progressId.current = result.progress.id;
        const pushed = progressPushes.current.get(result.progress.id);
        const newest = pushed && pushed.sequence > requestSequence ? pushed.progress : result.progress;
        lastTerminalProgress.current =
          newest.status === 'running'
            ? null
            : JSON.stringify([newest.id, newest.status, newest.completed, newest.failed]);
        setData(result);
        setProgress(newest);
        setLoading(false);
        if (newest.status !== 'running' && result.progress.status === 'running') {
          setLoading(true);
          setRevision((value) => value + 1);
        }
      })
      .catch((error) => {
        logger.error(error);
        if (!disposed) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [client, scopeKey, page, filter, findingCode, kind, revision]);

  useEffect(() => {
    let disposed = false;
    const update = (next: RecordingQueue) => {
      if (!disposed) setQueue((previous) => (previous && previous.updatedAt > next.updatedAt ? previous : next));
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

  const control = async (action: 'cancel' | 'retry') => {
    setControlling(true);
    setFailed(false);
    try {
      const next = await client.send({
        name: RendererClientMessageName.ControlDeathReview,
        payload: { ...scope, action },
      });
      progressId.current = next.id;
      setProgress(next);
      setLoading(true);
      setRevision((value) => value + 1);
    } catch (error) {
      logger.error(error);
      setFailed(true);
    } finally {
      setControlling(false);
    }
  };

  const queueItem = (record: DeathReviewRecord): RecordingQueueItem | undefined => {
    const request = record.recordingRequest;
    if (!request) return undefined;
    return queue?.items.find(
      (item) =>
        item.includeOpponent === (request.includeOpponent ?? true) &&
        item.request.checksum === request.checksum &&
        item.request.steamId === request.steamId &&
        item.request.roundNumber === request.roundNumber &&
        item.request.startTick === request.startTick &&
        item.request.endTick === request.endTick &&
        (!request.opponentSteamId || item.request.opponentSteamId === request.opponentSteamId),
    );
  };
  const toggleQueue = async (record: DeathReviewRecord) => {
    if (!record.recordingRequest || !canReplayDeath(record)) return;
    const current = queueItem(record);
    if (current && ['active', 'ready'].includes(current.status)) return;
    setQueueBusy(true);
    setQueueFailed(false);
    try {
      let next: RecordingQueue;
      if (current?.status === 'pending') {
        next = await client.send({
          name: RendererClientMessageName.ControlRecordingQueue,
          payload: { action: 'remove', ids: [current.id] },
        });
      } else if (current && ['failed', 'canceled'].includes(current.status)) {
        next = await client.send({
          name: RendererClientMessageName.ControlRecordingQueue,
          payload: { action: 'retry', ids: [current.id] },
        });
      } else {
        next = await client.send({
          name: RendererClientMessageName.AddToRecordingQueue,
          payload: {
            clips: [record.recordingRequest],
            includeOpponent: record.recordingRequest.includeOpponent ?? true,
          },
        });
      }
      setQueue((previous) => (previous && previous.updatedAt > next.updatedAt ? previous : next));
    } catch {
      setQueueFailed(true);
    } finally {
      setQueueBusy(false);
    }
  };

  const ready = Boolean(
    data &&
    data.coverage.missingMatches === 0 &&
    data.coverage.failedMatches === 0 &&
    (progress?.status === 'completed' || (progress?.status === 'idle' && data.coverage.availableMatches === 0)),
  );
  const processed = (progress?.completed ?? 0) + (progress?.failed ?? 0);
  const totalDemos = progress?.total ?? 0;
  const successful = progress?.completed ?? 0;
  const failedDemos = progress?.failed ?? 0;
  const pageNumber = (data?.page ?? 0) + 1;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));
  const totalDeaths = data?.total ?? 0;
  const resetPage = () => {
    setLoading(true);
    setFailed(false);
    setPage(0);
    setSelectedId(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-16">
      <header className="flex flex-wrap items-start justify-between gap-12 rounded-12 border border-gray-300 bg-gray-100 p-20">
        <div className="flex min-w-0 flex-col gap-8">
          <h2 className="text-subtitle">
            <Trans>Every death</Trans>
          </h2>
          <p className="text-body text-gray-700">
            <Trans>Follow each death through its events, rule checks, and one action to practice.</Trans>
          </p>
        </div>
        <Link className="text-body text-accent" to={RoutePath.RecordingQueue}>
          <Trans>Open recording queue</Trans>
        </Link>
      </header>

      {progress && !ready && (
        <section
          className="flex flex-col gap-12 rounded-12 border border-gray-300 bg-gray-100 p-16"
          aria-label={t`Death review preparation`}
        >
          <div className="flex flex-wrap items-center justify-between gap-12">
            <p className="text-body-strong">
              {progress.status === 'running' ? (
                <Trans>Preparing death reviews</Trans>
              ) : progress.status === 'canceled' ? (
                <Trans>Death review preparation paused</Trans>
              ) : failedDemos > 0 ? (
                <Trans>Some demos need another attempt</Trans>
              ) : (
                <Trans>Death review data is not ready</Trans>
              )}
            </p>
            <span className="text-body tabular-nums">
              <Trans>
                {processed} / {totalDemos} demos processed
              </Trans>
            </span>
          </div>
          <progress
            className="w-full"
            value={processed}
            max={Math.max(1, totalDemos)}
            aria-label={t`Death review progress`}
          />
          <div className="flex flex-wrap items-center justify-between gap-12">
            <span className="text-caption text-gray-700">
              <Trans>
                {successful} ready · {failedDemos} failed
              </Trans>
            </span>
            {progress.status === 'running' ? (
              <ReviewButton disabled={controlling} onClick={() => void control('cancel')}>
                <Trans>Pause preparation</Trans>
              </ReviewButton>
            ) : (
              <ReviewButton disabled={controlling} onClick={() => void control('retry')}>
                <Trans>Continue and retry missing demos</Trans>
              </ReviewButton>
            )}
          </div>
          {progress.currentDemoName && progress.status === 'running' && (
            <p role="status" className="text-caption wrap-anywhere text-gray-700">
              {progress.currentDemoName}
            </p>
          )}
          {progress.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-body text-red-500">
                <Trans>Failed demos</Trans> · {progress.errors.length}
              </summary>
              <ul className="mt-12 flex flex-col gap-8">
                {progress.errors.map((error) => (
                  <li key={error.checksum} className="rounded-8 bg-gray-75 p-12 text-caption wrap-anywhere">
                    <p className="font-semibold">{error.checksum}</p>
                    <p className="mt-4 text-gray-700">{error.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {loading && !progress && (
        <p role="status">
          <Trans>Loading death review data…</Trans>
        </p>
      )}
      {failed && (
        <div role="alert" className="flex flex-wrap items-center gap-12 rounded-8 border border-gray-300 p-16">
          <p className="text-red-500">
            <Trans>Death reviews could not be loaded.</Trans>
          </p>
          <ReviewButton
            onClick={() => {
              setLoading(true);
              setFailed(false);
              setRevision((value) => value + 1);
            }}
          >
            <Trans>Retry</Trans>
          </ReviewButton>
        </div>
      )}

      {ready && data && (
        <>
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
            {[
              { value: 'all' as const, title: t`All deaths`, count: data.totals.deaths },
              { value: 'flagged' as const, title: t`With review points`, count: data.totals.flagged },
              { value: 'needs-data' as const, title: t`Missing extra data`, count: data.totals.needsData },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                className={`flex min-w-0 flex-col gap-8 rounded-12 border p-16 text-left ${filter === item.value ? 'border-accent-muted bg-accent-soft text-accent' : 'border-gray-300 bg-gray-100 text-gray-800'}`}
                onClick={() => {
                  if (filter === item.value && page === 0) return;
                  setFilter(item.value);
                  resetPage();
                }}
              >
                <span className="text-caption">{item.title}</span>
                <strong className="text-heading tabular-nums">{item.count}</strong>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-12">
            <Select
              label={t`Rule`}
              value={findingCode}
              onChange={(value) => {
                if (findingCode === value && page === 0) return;
                setFindingCode(value);
                resetPage();
              }}
              options={[
                { value: 'all', label: t`All rules` },
                ...DEATH_RULES.filter((rule) => rule.support !== 'unavailable').map((rule) => ({
                  value: rule.code,
                  label: copy.rules[rule.code]?.title ?? rule.code,
                })),
              ]}
            />
            <Select
              label={t`Death type`}
              value={kind}
              onChange={(value) => {
                if (kind === value && page === 0) return;
                setKind(value);
                resetPage();
              }}
              options={[
                { value: 'all' as const, label: t`All death types` },
                ...Object.entries(copy.kinds).map(([value, label]) => ({ value: value as DeathKind, label })),
              ]}
            />
            <span className="pb-8 text-caption text-gray-700">
              <Trans>
                {totalDeaths} deaths · page {pageNumber} of {pages}
              </Trans>
            </span>
          </div>
          {loading ? (
            <p role="status">
              <Trans>Loading deaths…</Trans>
            </p>
          ) : (
            !failed && (
              <div className="flex min-w-0 flex-col gap-8">
                {data.items.map((record) => {
                  const round = record.roundNumber;
                  const selected = selectedId === record.id;
                  const queued = queueItem(record);
                  const reviewed = record.findings.filter((finding) => finding.kind === 'review');
                  const badges = (reviewed.length ? reviewed : record.findings).slice(0, 2);
                  return (
                    <article
                      key={record.id}
                      className={`min-w-0 overflow-hidden rounded-12 border bg-gray-100 ${selected ? 'border-accent-muted' : 'border-gray-300'}`}
                    >
                      <div className="flex flex-wrap items-center gap-12 p-16">
                        <button
                          type="button"
                          aria-expanded={selected}
                          className="flex min-w-0 flex-1 flex-col gap-8 text-left"
                          onClick={() => setSelectedId(selected ? null : record.id)}
                        >
                          <span className="text-body-strong wrap-anywhere">
                            {record.mapName} · {round > 0 ? t`Round ${round}` : t`Outside a numbered round`} ·{' '}
                            {record.side === TeamNumber.CT ? 'CT' : record.side === TeamNumber.T ? 'T' : '—'}
                          </span>
                          <span className="text-caption wrap-anywhere text-gray-700">
                            {formatDate(record.date)} · {copy.kinds[record.kind]}
                            {record.killerName ? ` · ${record.killerName}` : ''}
                            {record.weapon ? ` · ${record.weapon}` : ''}
                          </span>
                          <span className="flex flex-wrap gap-8">
                            {badges.map((finding) => (
                              <span
                                key={finding.code}
                                className="rounded-4 bg-gray-75 px-8 py-4 text-caption text-gray-800"
                              >
                                {copy.rules[finding.code]?.title ?? finding.code}
                              </span>
                            ))}
                            {record.findings.length === 0 && (
                              <span className="text-caption text-gray-700">
                                {record.evaluatedRules.length === 0 ? (
                                  <Trans>Not applicable here</Trans>
                                ) : (
                                  <Trans>No matching rule</Trans>
                                )}
                              </span>
                            )}
                            {record.missingSignals.length > 0 && (
                              <span className="rounded-4 bg-gray-75 px-8 py-4 text-caption text-gray-700">
                                <Trans>Extra data needed</Trans>
                              </span>
                            )}
                          </span>
                        </button>
                        <div className="flex flex-wrap items-center gap-12">
                          {canReplayDeath(record) && (
                            <Checkbox
                              label={
                                queued?.status === 'ready'
                                  ? t`Video saved`
                                  : queued?.status === 'active'
                                    ? t`In this session`
                                    : t`Record this death`
                              }
                              isChecked={Boolean(queued && ['pending', 'active', 'ready'].includes(queued.status))}
                              isDisabled={
                                queueBusy || !queue || queued?.status === 'active' || queued?.status === 'ready'
                              }
                              onChange={() => void toggleQueue(record)}
                            />
                          )}
                          <ReviewButton primary={selected} onClick={() => setSelectedId(selected ? null : record.id)}>
                            {selected ? <Trans>Close details</Trans> : <Trans>Review death</Trans>}
                          </ReviewButton>
                        </div>
                      </div>
                      {selected && <DeathReviewDetail key={record.id} record={record} />}
                    </article>
                  );
                })}
                {data.items.length === 0 && (
                  <p className="rounded-8 bg-gray-100 p-20 text-gray-700">
                    <Trans>No deaths match these filters.</Trans>
                  </p>
                )}
              </div>
            )
          )}
          <div className="flex flex-wrap gap-8">
            <ReviewButton
              disabled={loading || pageNumber <= 1}
              onClick={() => {
                setLoading(true);
                setFailed(false);
                setSelectedId(null);
                setPage(pageNumber - 2);
              }}
            >
              <Trans>Previous</Trans>
            </ReviewButton>
            <ReviewButton
              disabled={loading || pageNumber >= pages}
              onClick={() => {
                setLoading(true);
                setFailed(false);
                setSelectedId(null);
                setPage(pageNumber);
              }}
            >
              <Trans>Next</Trans>
            </ReviewButton>
          </div>
        </>
      )}
      {queueFailed && (
        <p role="alert" className="text-red-500">
          <Trans>Could not update the recording queue.</Trans>
        </p>
      )}
    </div>
  );
}
