import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { DEATH_RULES } from 'csdm/common/death-review/death-rules';
import type { DeathFinding, DeathMeasure, DeathReviewRecord } from 'csdm/common/types/death-review';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { HabitsPlaybackButton } from './habits-playback-button';
import { useDeathReviewCopy } from './use-death-review-copy';
import { ReviewButton } from './review-button';

export function canReplayDeath(record: DeathReviewRecord) {
  return (
    record.recordingRequest !== null &&
    Number.isSafeInteger(record.roundNumber) &&
    record.roundNumber > 0 &&
    Number.isSafeInteger(record.startTick) &&
    Number.isSafeInteger(record.endTick) &&
    Number.isSafeInteger(record.eventTick) &&
    Number.isFinite(record.tickrate) &&
    record.tickrate > 0 &&
    record.startTick >= 0 &&
    record.eventTick >= record.startTick &&
    record.eventTick <= record.endTick &&
    record.endTick > record.startTick
  );
}

function evidencePath(record: DeathReviewRecord, tick: number) {
  return `${buildMatch2dViewerRoundPath(record.checksum, record.roundNumber)}?${new URLSearchParams({ player: record.steamId, tick: String(tick) })}`;
}

function measureValue(measure: DeathMeasure) {
  const value = Number(measure.value.toFixed(2));
  if (measure.unit === 'seconds') return `${value} s`;
  if (measure.unit === 'degrees') return `${value}°`;
  if (measure.unit === 'speed') return `${value} u/s`;
  if (measure.unit === 'units') return `${value} u`;
  return String(value);
}

function Finding({
  finding,
  record,
  initiallyOpen,
}: {
  finding: DeathFinding;
  record: DeathReviewRecord;
  initiallyOpen: boolean;
}) {
  const { t } = useLingui();
  const copy = useDeathReviewCopy();
  const rule = copy.rules[finding.code];
  const title = rule?.title ?? t`Review condition`;
  return (
    <details open={initiallyOpen} className="rounded-8 border border-gray-300 bg-gray-100">
      <summary className="cursor-pointer p-12 text-body-strong marker:text-accent">
        {title}
        <span className="ml-8 text-caption font-normal text-gray-700">{copy.categories[finding.category]}</span>
      </summary>
      <div className="flex flex-col gap-12 border-t border-gray-300 p-12">
        <span className="text-caption font-semibold text-accent">
          {finding.kind === 'review' ? <Trans>Review this decision</Trans> : <Trans>Recorded state</Trans>}
        </span>
        {finding.measures.length > 0 && (
          <dl className="flex flex-wrap gap-12 text-body tabular-nums">
            {finding.measures.map((measure, index) => (
              <div key={`${measure.key}:${index}`} className="rounded-4 bg-gray-75 px-8 py-4">
                <dt className="text-caption text-gray-700">{copy.measures[measure.key] ?? measure.key}</dt>
                <dd className="font-semibold">{measureValue(measure)}</dd>
              </div>
            ))}
          </dl>
        )}
        {rule?.action && (
          <div className="border-l border-accent-muted pl-12">
            <h4 className="mb-4 text-caption font-semibold text-accent">
              <Trans>Replay and practice</Trans>
            </h4>
            <p className="text-body text-gray-800">{rule.action}</p>
          </div>
        )}
        {canReplayDeath(record) && finding.evidenceTicks.length > 0 && (
          <div className="flex flex-wrap gap-8">
            {[...new Set(finding.evidenceTicks)].filter(Number.isSafeInteger).map((tick) => {
              const seconds = ((tick - record.eventTick) / record.tickrate).toFixed(1);
              const offset = Number(seconds) > 0 ? `+${seconds}` : seconds;
              return (
                <Link
                  key={tick}
                  to={evidencePath(record, tick)}
                  className="rounded-4 bg-accent-soft px-8 py-4 text-caption text-accent"
                >
                  <Trans>Evidence at {offset} s</Trans>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

export function DeathReviewDetail({ record }: { record: DeathReviewRecord }) {
  const { t } = useLingui();
  const copy = useDeathReviewCopy();
  const canReplay = canReplayDeath(record);
  const [timelineLimit, setTimelineLimit] = useState(12);
  const deathIndex = record.timeline.findIndex((event) => event.kind === 'death' && event.tick === record.eventTick);
  const timelineStart = Math.max(
    0,
    Math.min(deathIndex - Math.floor((timelineLimit * 2) / 3), record.timeline.length - timelineLimit),
  );
  const findings = record.findings.toSorted((a, b) => Number(b.kind === 'review') - Number(a.kind === 'review'));
  const evaluated = record.evaluatedRules.length;
  const supported = DEATH_RULES.filter((rule) => rule.support !== 'unavailable');
  const supportedCount = supported.length;
  const unavailable = DEATH_RULES.filter((rule) => rule.support === 'unavailable');
  const otherPlayers = [...new Set(record.timeline.flatMap((event) => [event.actor, event.target]))].filter(
    (id): id is string => Boolean(id && /^\d{17}$/.test(id) && id !== record.steamId && id !== record.killerSteamId),
  );
  const playerLabel = (id: string | undefined) => {
    if (!id) return undefined;
    if (id === record.steamId) return t`You`;
    if (id === record.killerSteamId) return record.killerName || t`Killer`;
    if (id === '0') return t`Environment`;
    const number = otherPlayers.indexOf(id) + 1;
    return number > 0 ? t`Player ${number}` : id;
  };
  const facts = [
    { label: t`Health before the final hit`, value: record.healthBeforeHit ?? '—' },
    { label: t`Living teammates`, value: record.teammatesAlive ?? '—' },
    { label: t`Living enemies`, value: record.enemiesAlive ?? '—' },
    { label: t`Killer distance`, value: record.distance === null ? '—' : `${Math.round(record.distance)} u` },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-16 border-t border-gray-300 p-16">
      <dl className="grid grid-cols-2 gap-12 xl:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 rounded-8 bg-gray-75 p-12">
            <dt className="text-caption text-gray-700">{fact.label}</dt>
            <dd className="mt-4 text-heading tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {canReplay && (
        <div className="flex flex-wrap items-start gap-12">
          <Link
            to={evidencePath(record, record.startTick)}
            className="rounded-8 border border-accent-muted bg-accent-soft px-16 py-10 text-body text-accent"
          >
            <Trans>Open 2D context</Trans>
          </Link>
          <div className="flex flex-col gap-4">
            <span className="text-caption text-gray-700">
              <Trans>Your view</Trans>
            </span>
            <HabitsPlaybackButton
              checksum={record.checksum}
              steamId={record.steamId}
              tick={record.startTick}
              roundNumber={record.roundNumber}
            />
          </div>
          {record.recordingRequest?.opponentSteamId && (
            <div className="flex flex-col gap-4">
              <span className="text-caption text-gray-700">
                <Trans>Opponent view</Trans>
              </span>
              <HabitsPlaybackButton
                checksum={record.checksum}
                steamId={record.recordingRequest.opponentSteamId}
                tick={record.startTick}
                roundNumber={record.roundNumber}
              />
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-16 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-12">
          <h3 className="text-body-strong">
            <Trans>Death timeline</Trans>
          </h3>
          <ol className="flex flex-col gap-8">
            {record.timeline.slice(timelineStart, timelineStart + timelineLimit).map((event) => {
              const offset = `${event.seconds > 0 ? '+' : ''}${event.seconds.toFixed(1)}`;
              const title = copy.events[event.kind];
              const detail = [
                playerLabel(event.actor),
                event.target ? `→ ${playerLabel(event.target)}` : undefined,
                event.weapon,
              ]
                .filter(Boolean)
                .join(' · ');
              const value = event.value === undefined ? null : Number(event.value.toFixed(2));
              const valueText = value === null ? null : event.kind === 'blind' ? `${value} s` : String(value);
              return (
                <li
                  key={event.id}
                  className={`flex min-w-0 items-start gap-12 rounded-8 p-12 ${event.kind === 'death' ? 'border border-accent-muted bg-accent-soft' : 'bg-gray-75'}`}
                >
                  <span className="shrink-0 text-caption text-gray-700 tabular-nums">{offset} s</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-strong">
                      {title}
                      {valueText !== null && ` · ${valueText}`}
                    </p>
                    {detail && <p className="mt-4 text-caption wrap-anywhere text-gray-700">{detail}</p>}
                  </div>
                  {canReplay && Number.isSafeInteger(event.tick) && (
                    <Link
                      to={evidencePath(record, event.tick)}
                      className="shrink-0 text-caption text-accent"
                      aria-label={t`Open ${title} at ${offset} seconds in 2D`}
                    >
                      <Trans>Locate</Trans>
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
          {record.timeline.length > timelineLimit && (
            <div>
              <ReviewButton onClick={() => setTimelineLimit((value) => value + 12)}>
                <Trans>Show more events</Trans>
              </ReviewButton>
            </div>
          )}
          {record.timeline.length === 0 && (
            <p className="text-body text-gray-700">
              <Trans>No timeline events are available for this death.</Trans>
            </p>
          )}
        </section>
        <section className="flex min-w-0 flex-col gap-12">
          <h3 className="text-body-strong">
            <Trans>Triggered rules</Trans> · {findings.length}
          </h3>
          {findings.length === 0 ? (
            <p className="rounded-8 bg-gray-75 p-12 text-body text-gray-700">
              {evaluated === 0 ? (
                <Trans>Not applicable here</Trans>
              ) : (
                <Trans>No current rule matched this death.</Trans>
              )}
            </p>
          ) : (
            findings.map((finding, index) => (
              <Finding key={finding.code} finding={finding} record={record} initiallyOpen={index === 0} />
            ))
          )}
        </section>
      </div>
      <details className="rounded-8 border border-gray-300 p-12">
        <summary className="cursor-pointer text-body-strong">
          <Trans>Rule coverage</Trans> ·{' '}
          <Trans>
            {evaluated} / {supportedCount} automatic rules evaluated
          </Trans>
        </summary>
        <div className="mt-12 flex flex-col gap-16 text-body">
          {record.missingSignals.length > 0 && (
            <div>
              <p className="mb-8 font-semibold">
                <Trans>Data needed for additional checks</Trans>
              </p>
              <div className="flex flex-wrap gap-8">
                {record.missingSignals.map((signal) => (
                  <span key={signal} className="rounded-4 bg-gray-75 px-8 py-4">
                    {copy.signals[signal]}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {supported.map((rule) => (
              <div
                key={rule.code}
                className="flex flex-wrap items-center justify-between gap-8 border-b border-gray-300 py-8"
              >
                <span>{copy.rules[rule.code]?.title ?? rule.code}</span>
                <span className="text-caption text-gray-700">
                  {record.evaluatedRules.includes(rule.code)
                    ? t`Checked`
                    : rule.requires.some((signal) => record.missingSignals.includes(signal))
                      ? t`Needs data`
                      : t`Not applicable here`}
                </span>
              </div>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-gray-700">
              <Trans>Checks not enabled in this version</Trans>
            </summary>
            <ul className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
              {unavailable.map((rule) => (
                <li key={rule.code} className="rounded-4 bg-gray-75 p-8">
                  <p>{copy.rules[rule.code]?.title ?? rule.code}</p>
                  <p className="mt-4 text-caption text-gray-700">
                    {rule.requires.map((signal) => copy.signals[signal]).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </div>
  );
}
