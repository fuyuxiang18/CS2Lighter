import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeathEvidenceReport, DeathEvidenceState, InspectDeathEvidence } from 'csdm/common/types/death-evidence';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { ReviewButton } from './review-button';
import { DeathRiskPanel, DeathRiskCoverage } from './death-risk-panel';
import { DeathMechanicsTable } from './death-mechanics-table';

function replayPath(record: DeathReviewRecord, tick: number) {
  return `${buildMatch2dViewerRoundPath(record.checksum, record.roundNumber)}?${new URLSearchParams({ player: record.steamId, tick: String(tick) })}`;
}

function EvidenceLink({ record, tick }: { record: DeathReviewRecord; tick: number }) {
  if (record.roundNumber <= 0 || !Number.isSafeInteger(tick) || tick < 0) return null;
  const offset = ((tick - record.eventTick) / record.tickrate).toFixed(2);
  return (
    <Link
      to={replayPath(record, tick)}
      className="shrink-0 rounded-4 bg-accent-soft px-8 py-4 text-caption text-accent"
    >
      <Trans>Replay {offset} s</Trans>
    </Link>
  );
}

function FiringChart({ report }: { report: DeathEvidenceReport }) {
  const { t } = useLingui();
  const [selectedBurst, setSelectedBurst] = useState<string | null>(null);
  const bursts = [...new Set(report.spray.points.flatMap((point) => (point.burstId ? [point.burstId] : [])))];
  const shots = report.spray.points.filter(
    (point) =>
      Number.isFinite(point.pitch) &&
      Number.isFinite(point.yaw) &&
      (selectedBurst === null || point.burstId === selectedBurst),
  );
  if (shots.length === 0)
    return (
      <p className="rounded-8 bg-gray-75 p-16 text-body text-gray-700">
        <Trans>No shots were recorded in this window.</Trans>
      </p>
    );
  const first = shots[0];
  const yawOffset = (yaw: number) => ((yaw - first.yaw + 540) % 360) - 180;
  const points = shots.map((shot, index) => ({
    ...shot,
    number: index + 1,
    x: yawOffset(shot.yaw),
    y: first.pitch - shot.pitch,
  }));
  const minX = Math.min(-1, ...points.map((point) => point.x));
  const maxX = Math.max(1, ...points.map((point) => point.x));
  const minY = Math.min(-1, ...points.map((point) => point.y));
  const maxY = Math.max(1, ...points.map((point) => point.y));
  const x = (value: number) => 42 + ((value - minX) / (maxX - minX)) * 460;
  const y = (value: number) => 214 - ((value - minY) / (maxY - minY)) * 182;
  const groups: (typeof points)[] = [];
  for (const point of points) {
    const previous = groups.at(-1)?.at(-1);
    if (
      !previous ||
      !point.burstId ||
      point.burstId !== previous.burstId ||
      point.tick <= previous.tick ||
      point.tick - previous.tick > report.tickrate * 0.6 ||
      point.itemDefinitionIndex !== previous.itemDefinitionIndex
    )
      groups.push([point]);
    else groups.at(-1)!.push(point);
  }
  const count = shots.length;
  return (
    <div className="min-w-0 rounded-8 border border-gray-300 bg-gray-75 p-12">
      {bursts.length > 1 && (
        <div className="mb-12 flex flex-wrap gap-8">
          <ReviewButton pressed={selectedBurst === null} onClick={() => setSelectedBurst(null)}>
            <Trans>All shots</Trans>
          </ReviewButton>
          {bursts.map((burstId, index) => {
            const number = index + 1;
            return (
              <ReviewButton key={burstId} pressed={selectedBurst === burstId} onClick={() => setSelectedBurst(burstId)}>
                <Trans>Burst {number}</Trans>
              </ReviewButton>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-8 text-caption text-gray-700">
        <span>
          <Trans>Firing-center angles</Trans>
        </span>
        <span>
          <Trans>{count} shots · first shot is the origin</Trans>
        </span>
      </div>
      <svg
        viewBox="0 0 550 250"
        role="img"
        aria-label={t`Recorded firing directions in shot order`}
        className="w-full text-gray-500"
      >
        <line x1="42" y1={y(0)} x2="502" y2={y(0)} stroke="currentColor" strokeDasharray="4 4" />
        <line x1={x(0)} y1="32" x2={x(0)} y2="214" stroke="currentColor" strokeDasharray="4 4" />
        <text x="42" y="235" fill="currentColor" fontSize="11">
          {minX.toFixed(1)}°
        </text>
        <text x="502" y="235" textAnchor="end" fill="currentColor" fontSize="11">
          {maxX.toFixed(1)}°
        </text>
        <text x="32" y="36" textAnchor="end" fill="currentColor" fontSize="11">
          {maxY.toFixed(1)}°
        </text>
        <text x="32" y="214" textAnchor="end" fill="currentColor" fontSize="11">
          {minY.toFixed(1)}°
        </text>
        {groups.map((group) => (
          <polyline
            key={group[0].id}
            points={group.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-accent"
          />
        ))}
        {points.map((point, index) => {
          const shotNumber = point.number;
          const seconds = ((point.tick - report.deathTick) / report.tickrate).toFixed(2);
          return (
            <g key={point.id} className="text-accent">
              <circle cx={x(point.x)} cy={y(point.y)} r={index === 0 ? 4 : 3} fill="currentColor">
                <title>{t`Shot ${shotNumber} at ${seconds} s`}</title>
              </circle>
              {(points.length <= 20 || index === 0 || index === points.length - 1) && (
                <text x={x(point.x) + 5} y={y(point.y) - 5} fill="currentColor" fontSize="10">
                  {shotNumber}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between gap-8 text-caption text-gray-700">
        <span>
          <Trans>Vertical angle ↑</Trans>
        </span>
        <span>
          <Trans>Horizontal angle →</Trans>
        </span>
      </div>
    </div>
  );
}

function EvidenceResults({ report, record }: { report: DeathEvidenceReport; record: DeathReviewRecord }) {
  const { t } = useLingui();
  const [showAllLines, setShowAllLines] = useState(false);
  const reasons: Record<string, string> = {
    'installed-build-mismatch': t`The installed map version differs from this demo`,
    'map-version': t`The map version has not been matched`,
    'map-unverified': t`The map version has not been matched`,
    'geometry-incomplete': t`Map geometry is incomplete`,
    'geometry-provider-unavailable': t`Target geometry is not available`,
    'body-unverified': t`Animated player bounds are not available`,
    'dynamic-incomplete': t`Dynamic object coverage is incomplete`,
    'dynamic-uncertain': t`A dynamic object intersects this firing line`,
    'dynamic-object-not-resolved': t`A dynamic object has not been resolved`,
    'eye-unverified': t`Eye-position evidence is missing`,
    'fov-unverified': t`Camera projection evidence is missing`,
    'flash-unverified': t`Flash-effect timing is incomplete`,
    flashed: t`The viewer was affected by a flash`,
    'outside-fov': t`Outside the recorded view`,
    occluded: t`Blocked by geometry`,
    'volume-occluded': t`Blocked by geometry`,
    'edge-clearance': t`The firing line is close to a geometry edge`,
    'extraction-incomplete': t`Some requested ticks are missing`,
    'tick-rate-mismatch': t`The evidence clocks do not agree`,
    'database-shots-incomplete': t`Shot-event coverage is incomplete`,
    'player-lifecycle-unverified': t`The firing player's entity could not be matched`,
    'round-unverified': t`The shot could not be matched to this round`,
    'shot-event-join-ambiguous': t`A shot could not be matched uniquely`,
    'damage-event-join-ambiguous': t`A damage event could not be matched uniquely`,
    'target-switch': t`The firing sequence changes targets`,
    'geometry-provenance-unverified': t`The target geometry has not been verified`,
    'geometry-shot-mismatch': t`Shot-time geometry does not match`,
    'no-unambiguous-damage-target': t`No uniquely matched damage target in this window`,
    'no-raw-shots': t`No raw firing events in this window`,
    'game-not-installed': t`A local CS2 installation is needed for map geometry`,
    'invalid-extraction': t`The extraction could not be used`,
    'missing-extraction-ticks': t`Some requested ticks are missing`,
    'invalid-extraction-order': t`The evidence timeline could not be joined`,
    'environment-candidate-coverage-unverified': t`Environment object coverage is incomplete`,
    'unsupported-environment-classes': t`Some environment object types need geometry`,
    'unbounded-dynamic-model': t`Some dynamic models need geometry`,
    'world-baseline-missing': t`The environment baseline is missing`,
    'smoke-baseline-missing': t`The smoke baseline is missing`,
    'active-smoke-bounds-unverified': t`Active smoke geometry is unavailable`,
    'no-living-opponent-eye-pairs': t`No living opponent positions in this window`,
    'dynamic-model-resolution-failed': t`A dynamic model could not be loaded`,
    'dynamic-transform-unverified': t`A dynamic model transform is incomplete`,
    'environment-clear': t`Clear environment firing line`,
    clear: t`Clear environment firing line`,
    'invalid-input': t`The geometry evidence is incomplete`,
    'invalid-range': t`The geometry evidence is incomplete`,
    'dense-region': t`This geometry region exceeds the analysis budget`,
    'unsupported-map-name': t`This map is not supported yet`,
    'invalid-directory': t`The local CS2 folder is unavailable`,
    'map-render-dependencies-missing': t`Some map model resources are missing`,
    'unsupported-map-exporter': t`The map extraction tool needs an update`,
    'map-preparation-failed': t`Map geometry could not be prepared`,
    'shot-identity-incomplete': t`Some firing events could not be matched to the player`,
    'no-shots-in-window': t`No shots were recorded in this window.`,
    'no-continuous-burst': t`No continuous firing burst in this window`,
  };
  const reasonLabel = (reason: string) => reasons[reason] ?? reasons[reason.split(':')[0]] ?? reason;
  const motionTitles = {
    firing_rise: t`Firing direction rises during the burst`,
    firing_fall: t`Firing direction lowers during the burst`,
    firing_lateral_swings: t`Firing direction swings from side to side`,
  };
  const motions = report.spray.motion ?? [];
  const mechanicsReasons = {
    'shot-state-incomplete': t`The player's state around the firing instant is incomplete.`,
    'weapon-profile-unverified': t`This demo's weapon profile has not been verified.`,
    'shot-accuracy-missing': t`The native shot accuracy parameters are missing.`,
    'no-material-accuracy-loss': t`No material loss from the stationary accuracy baseline was recorded.`,
    'accuracy-component-unverified': t`The accuracy change cannot be assigned to movement, landing or previous shots.`,
    'target-exchange-unverified': t`This shot could not be linked uniquely to a target exchange.`,
    'target-body-clock-unverified': t`Target body geometry and its firing-time alignment are unavailable.`,
  };
  const decoded = report.coverage.decodedTicks;
  const requested = report.coverage.requestedTicks;
  const evidenceReasons = [
    ...new Set([...report.geometry.reasons, ...(report.gunlineAnalysis?.reasons ?? []), ...report.spray.reasons]),
  ];
  const lineStatuses = { clear: t`Unobstructed`, blocked: t`Blocked`, unknown: t`Needs evidence` };
  const nearestLines = new Map<string, DeathEvidenceReport['gunlines'][number]>();
  for (const line of report.gunlines) {
    if (line.tick > report.deathTick) continue;
    const previous = nearestLines.get(line.enemySteamId);
    if (!previous || line.tick > previous.tick) nearestLines.set(line.enemySteamId, line);
  }
  return (
    <div className="flex min-w-0 flex-col gap-16">
      <DeathRiskPanel report={report.risk} record={record} />
      {report.mechanics && <DeathMechanicsTable evidence={report.mechanics} record={record} />}
      <details className="rounded-8 border border-gray-300">
        <summary className="cursor-pointer p-12 text-body-strong">
          <Trans>Firing lines and shot traces</Trans>
        </summary>
        <div className="flex min-w-0 flex-col gap-12 border-t border-gray-300 p-12">
          {report.exposures.map((exposure) => {
            const enemies = exposure.enemyIds.length;
            const duration = ((exposure.endTick - exposure.startTick) / report.tickrate).toFixed(2);
            const angle = exposure.minimumAngleDegrees.toFixed(1);
            return (
              <article
                key={`${exposure.startTick}:${exposure.endTick}:${exposure.enemyIds.join(',')}`}
                className="rounded-8 border border-gray-300 bg-gray-75 p-12"
              >
                <div className="flex flex-wrap items-center justify-between gap-8">
                  <h4 className="text-body-strong">
                    <Trans>{enemies} opponents with clear firing lines</Trans>
                  </h4>
                  <EvidenceLink record={record} tick={exposure.startTick} />
                </div>
                <p className="mt-8 text-body">
                  <Trans>
                    {duration} s · at least {angle}° between firing lines
                  </Trans>
                </p>
              </article>
            );
          })}
          {nearestLines.size > 0 && (
            <details className="rounded-8 border border-gray-300">
              <summary className="cursor-pointer p-12 text-body">
                <Trans>Opponent directions near the death</Trans>
              </summary>
              <div className="flex flex-col gap-8 border-t border-gray-300 p-12">
                {Array.from(nearestLines.values(), (line, index) => {
                  const number = index + 1;
                  const opponent = line.enemySteamId === record.killerSteamId ? t`Killer` : t`Opponent ${number}`;
                  const angle = line.facingOffset?.toFixed(1);
                  return (
                    <div
                      key={line.enemySteamId}
                      className="flex flex-wrap items-center justify-between gap-8 rounded-4 bg-gray-75 p-8"
                    >
                      <div className="min-w-0 text-body">
                        <span className="font-semibold">{opponent}</span> · {lineStatuses[line.status]}
                        {angle !== undefined && (
                          <p className="mt-4 text-caption text-gray-700">
                            <Trans>{angle}° between their facing direction and you</Trans>
                          </p>
                        )}
                      </div>
                      <EvidenceLink record={record} tick={line.tick} />
                    </div>
                  );
                })}
              </div>
            </details>
          )}
          <FiringChart report={report} />
          {motions.map((motion) => {
            const shots = motion.shotIds.length;
            const degrees = motion.degrees.toFixed(1);
            const turns = motion.turns;
            return (
              <article
                key={`${motion.burstId}:${motion.code}`}
                className="rounded-8 border border-gray-300 bg-gray-75 p-12"
              >
                <div className="flex flex-wrap items-center justify-between gap-8">
                  <h4 className="text-body-strong">{motionTitles[motion.code]}</h4>
                  <EvidenceLink record={record} tick={motion.startTick} />
                </div>
                <p className="mt-8 text-caption text-gray-700">
                  {motion.code === 'firing_lateral_swings' ? (
                    <Trans>
                      {shots} shots · {turns} turns · {degrees}° horizontal range
                    </Trans>
                  ) : (
                    <Trans>
                      {shots} shots · {degrees}° vertical change
                    </Trans>
                  )}
                </p>
              </article>
            );
          })}
        </div>
      </details>
      <details className="rounded-8 border border-gray-300">
        <summary className="cursor-pointer p-12 text-body">
          <Trans>
            Evidence coverage · {decoded}/{requested} ticks
          </Trans>
        </summary>
        <div className="flex flex-col gap-12 border-t border-gray-300 p-12">
          {report.risk && <DeathRiskCoverage report={report.risk} />}
          {report.mechanics && report.mechanics.reasons.length > 0 && (
            <div className="flex flex-col gap-8">
              <h4 className="text-body-strong">
                <Trans>Accuracy evidence</Trans>
              </h4>
              {report.mechanics.reasons.map((reason) => {
                const shots = report
                  .mechanics!.measurements.flatMap((measurement, index) =>
                    measurement.reasons.includes(reason) ? [index + 1] : [],
                  )
                  .join(', ');
                return (
                  <p key={reason} className="text-caption text-gray-700">
                    {mechanicsReasons[reason]}
                    {shots && (
                      <>
                        {' '}
                        <Trans>Shots: {shots}</Trans>
                      </>
                    )}
                  </p>
                );
              })}
            </div>
          )}
          <p className="text-body">
            {report.geometry.mapName} ·{' '}
            {report.geometry.match === 'installed-build-matched' ? t`Map version matched` : t`Map version pending`}
          </p>
          {evidenceReasons.length > 0 && (
            <ul className="list-disc space-y-4 pl-16 text-caption text-gray-700">
              {evidenceReasons.map((reason) => (
                <li key={reason}>{reasonLabel(reason)}</li>
              ))}
            </ul>
          )}
          {report.gunlines.length > 0 && (
            <div className="flex flex-col gap-8">
              {report.gunlines.slice(0, showAllLines ? undefined : 8).map((line, index) => (
                <div
                  key={`${line.tick}:${line.enemySteamId}:${index}`}
                  className="flex flex-wrap items-center justify-between gap-8 rounded-4 bg-gray-75 p-8"
                >
                  <span className="text-caption">
                    {lineStatuses[line.status]} · {reasonLabel(line.reason)} · {Math.round(line.distance)} u
                  </span>
                  <EvidenceLink record={record} tick={line.tick} />
                </div>
              ))}
              {report.gunlines.length > 8 && !showAllLines && (
                <ReviewButton onClick={() => setShowAllLines(true)}>
                  <Trans>Show all firing-line samples</Trans>
                </ReviewButton>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export function DeathEvidencePanel({ record }: { record: DeathReviewRecord }) {
  return <EvidenceSession key={`${record.checksum}:${record.steamId}:${record.id}`} record={record} />;
}

function EvidenceSession({ record }: { record: DeathReviewRecord }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const [state, setState] = useState<DeathEvidenceState | null>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [controlling, setControlling] = useState(false);
  const mounted = useRef(true);
  const pushSequence = useRef(0);
  const latest = useRef<DeathEvidenceState | null>(null);
  const validTiming =
    Number.isSafeInteger(record.eventTick) &&
    record.eventTick >= 0 &&
    Number.isFinite(record.tickrate) &&
    record.tickrate > 0;
  const key = { checksum: record.checksum, steamId: record.steamId, deathId: record.id };
  const apply = (value: DeathEvidenceState) => {
    latest.current = value;
    setState(value);
    setRequestFailed(false);
  };
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const onUpdated = (value: DeathEvidenceState) => {
      if (
        disposed ||
        value.checksum !== record.checksum ||
        value.steamId !== record.steamId ||
        value.deathId !== record.id
      )
        return;
      pushSequence.current++;
      apply(value);
    };
    client.on(ServerPushMessageName.DeathEvidenceUpdated, onUpdated);
    const sequence = pushSequence.current;
    if (validTiming)
      void client
        .send({
          name: RendererClientMessageName.InspectDeathEvidence,
          payload: {
            checksum: record.checksum,
            steamId: record.steamId,
            deathId: record.id,
            action: 'read',
          },
        })
        .then(async (value) => {
          if (disposed) return;
          if (sequence === pushSequence.current) apply(value);
          if (latest.current?.status !== 'idle') return;
          const startSequence = pushSequence.current;
          const started = await client.send({
            name: RendererClientMessageName.InspectDeathEvidence,
            payload: {
              checksum: record.checksum,
              steamId: record.steamId,
              deathId: record.id,
              action: 'analyze',
            },
          });
          if (!disposed && startSequence === pushSequence.current) apply(started);
        })
        .catch((error) => {
          logger.error(error);
          if (!disposed && latest.current?.status !== 'completed' && latest.current?.status !== 'running')
            setRequestFailed(true);
        });
    return () => {
      disposed = true;
      mounted.current = false;
      client.off(ServerPushMessageName.DeathEvidenceUpdated, onUpdated);
    };
  }, [client, record.checksum, record.steamId, record.id, validTiming]);
  const control = async (action: InspectDeathEvidence['action']) => {
    setControlling(true);
    const sequence = pushSequence.current;
    try {
      const value = await client.send({
        name: RendererClientMessageName.InspectDeathEvidence,
        payload: { ...key, action },
      });
      if (mounted.current && sequence === pushSequence.current) apply(value);
    } catch (error) {
      logger.error(error);
      if (mounted.current && sequence === pushSequence.current) setRequestFailed(true);
    } finally {
      if (mounted.current) setControlling(false);
    }
  };
  const active = state?.status === 'running' || state?.status === 'queued';
  const phases = {
    prepare: t`Preparing this death window`,
    decode: t`Reading demo evidence`,
    map: t`Preparing map geometry`,
    evaluate: t`Checking operation risks`,
  };
  const completed = state?.completedTicks ?? 0;
  const total = state?.totalTicks ?? 0;
  const percentage = total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
  return (
    <section
      className="flex min-w-0 flex-col gap-12 rounded-8 border border-gray-300 bg-gray-100 p-16"
      aria-busy={active}
    >
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h3 className="text-body-strong">
          <Trans>Operation review</Trans>
        </h3>
        {active && (
          <ReviewButton onClick={() => void control('cancel')} disabled={controlling}>
            <Trans>Pause extraction</Trans>
          </ReviewButton>
        )}
        {state?.status === 'completed' && (
          <ReviewButton onClick={() => void control('refresh')} disabled={controlling}>
            {state.report?.risk ? <Trans>Refresh evidence</Trans> : <Trans>Run operation review</Trans>}
          </ReviewButton>
        )}
      </div>
      {!validTiming ? (
        <p className="text-body text-gray-700">
          <Trans>This event has no usable demo timing.</Trans>
        </p>
      ) : (
        <>
          {active && (
            <div className="flex flex-col gap-8">
              <div className="flex flex-wrap justify-between gap-8 text-body">
                <span>{state.status === 'queued' ? t`Waiting in the analysis queue` : phases[state.phase]}</span>
                <span className="tabular-nums">
                  <Trans>
                    {completed}/{total} ticks
                  </Trans>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={t`Death evidence extraction progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                className="h-8 overflow-hidden rounded-full bg-gray-300"
              >
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          )}
          {!state && !requestFailed && (
            <p className="text-body text-gray-700">
              <Trans>Loading saved evidence…</Trans>
            </p>
          )}
          {(requestFailed || state?.status === 'error') && (
            <div className="flex flex-wrap items-center justify-between gap-12">
              <p className="text-body">
                <Trans>Evidence extraction did not finish.</Trans>
              </p>
              <ReviewButton onClick={() => void control(state?.report ? 'refresh' : 'analyze')} disabled={controlling}>
                <Trans>Retry extraction</Trans>
              </ReviewButton>
            </div>
          )}
          {state?.status === 'canceled' && (
            <div className="flex flex-wrap items-center justify-between gap-12">
              <p className="text-body text-gray-700">
                <Trans>Extraction paused.</Trans>
              </p>
              <ReviewButton onClick={() => void control(state.report ? 'refresh' : 'analyze')} disabled={controlling}>
                <Trans>Resume extraction</Trans>
              </ReviewButton>
            </div>
          )}
          {state?.report && <EvidenceResults report={state.report} record={record} />}
          {state?.error && (
            <details className="text-caption text-gray-700">
              <summary className="cursor-pointer">
                <Trans>Error details</Trans>
              </summary>
              <p className="mt-8 wrap-anywhere">{state.error}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
