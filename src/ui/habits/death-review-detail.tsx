import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { HabitsPlaybackButton } from './habits-playback-button';
import { useDeathReviewCopy } from './use-death-review-copy';
import { ReviewButton } from './review-button';
import { DeathEvidencePanel } from './death-evidence-panel';
import { DEATH_BACKGROUND_CODES } from './death-review-presentation';

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
  const background = DEATH_BACKGROUND_CODES.flatMap((code) =>
    record.findings.some((finding) => finding.code === code) ? [copy.rules[code].title] : [],
  );
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
      <DeathEvidencePanel record={record} />
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
      <details className="rounded-8 border border-gray-300 bg-gray-75">
        <summary className="cursor-pointer p-12 text-body-strong">
          <Trans>Fight background</Trans>
          {background.length > 0 && (
            <span className="ml-8 text-caption font-normal text-gray-700">{background.slice(0, 3).join(' · ')}</span>
          )}
        </summary>
        <div className="flex flex-col gap-12 border-t border-gray-300 p-12">
          <dl className="grid grid-cols-2 gap-12 xl:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0 rounded-8 bg-gray-100 p-12">
                <dt className="text-caption text-gray-700">{fact.label}</dt>
                <dd className="mt-4 text-heading tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-8">
            {background.map((label) => (
              <span key={label} className="rounded-4 bg-gray-100 px-8 py-4 text-caption text-gray-800">
                {label}
              </span>
            ))}
          </div>
        </div>
      </details>
      <section className="flex min-w-0 flex-col gap-12">
        <h3 className="text-body-strong">
          <Trans>Fight timeline</Trans>
        </h3>
        <ol className="flex flex-col gap-8">
          {record.timeline.slice(timelineStart, timelineStart + timelineLimit).map((event) => {
            const offset = `${event.seconds > 0 ? '+' : ''}${event.seconds.toFixed(2)}`;
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
    </div>
  );
}
