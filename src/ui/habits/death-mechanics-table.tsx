import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans } from '@lingui/react/macro';
import type { DeathMechanicsEvidence } from 'csdm/common/types/death-mechanics';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { ReviewButton } from './review-button';

function angle(inaccuracy: number | null, spread: number | null) {
  return inaccuracy === null ||
    spread === null ||
    !Number.isFinite(inaccuracy) ||
    !Number.isFinite(spread) ||
    inaccuracy < 0 ||
    spread < 0
    ? '—'
    : `${((Math.atan(inaccuracy + spread) * 180) / Math.PI).toFixed(3)}°`;
}

export function DeathMechanicsTable({
  evidence,
  record,
}: {
  evidence: DeathMechanicsEvidence;
  record: DeathReviewRecord;
}) {
  const [limit, setLimit] = useState(12);
  if (evidence.measurements.length === 0) return null;
  return (
    <details className="min-w-0 rounded-8 border border-gray-300">
      <summary className="cursor-pointer p-12 text-body-strong">
        <Trans>Accuracy shot by shot</Trans> · {evidence.measurements.length}
      </summary>
      <div className="flex min-w-0 flex-col gap-12 border-t border-gray-300 p-12">
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-caption tabular-nums">
            <thead className="text-gray-700">
              <tr>
                <th className="p-8 font-medium">
                  <Trans>Shot</Trans>
                </th>
                <th className="p-8 font-medium">
                  <Trans>Weapon</Trans>
                </th>
                <th className="p-8 font-medium">
                  <Trans>Shot cone half-angle</Trans>
                </th>
                <th className="p-8 font-medium">
                  <Trans>Stationary baseline half-angle</Trans>
                </th>
                <th className="p-8 font-medium">
                  <Trans>Peak speed in shot interval</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {evidence.measurements.slice(0, limit).map((measurement, index) => {
                const offset = ((measurement.tick - record.eventTick) / record.tickrate).toFixed(2);
                const path = `${buildMatch2dViewerRoundPath(record.checksum, record.roundNumber)}?${new URLSearchParams({ player: record.steamId, tick: String(measurement.tick) })}`;
                return (
                  <tr key={measurement.shotId} className="border-t border-gray-300">
                    <td className="p-8">
                      <Link to={path} className="whitespace-nowrap text-accent">
                        #{index + 1} · {offset} s
                      </Link>
                    </td>
                    <td className="p-8">{measurement.weaponName}</td>
                    <td className="p-8 whitespace-nowrap">{angle(measurement.inaccuracy, measurement.spread)}</td>
                    <td className="p-8 whitespace-nowrap">
                      {angle(measurement.stationaryInaccuracy, measurement.spread)}
                    </td>
                    <td className="p-8 whitespace-nowrap">
                      {measurement.speed === null ? '—' : `${Number(measurement.speed.toFixed(1))} u/s`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {evidence.measurements.length > limit && (
          <div>
            <ReviewButton onClick={() => setLimit((value) => value + 12)}>
              <Trans>Show more shots</Trans>
            </ReviewButton>
          </div>
        )}
        <details className="text-caption text-gray-700">
          <summary className="cursor-pointer">
            <Trans>Raw accuracy parameters</Trans>
          </summary>
          <div className="mt-8 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-left tabular-nums">
              <thead>
                <tr>
                  <th className="p-8 font-medium">
                    <Trans>Shot</Trans>
                  </th>
                  <th className="p-8 font-medium">
                    <Trans>Inaccuracy radius</Trans>
                  </th>
                  <th className="p-8 font-medium">
                    <Trans>Spread radius</Trans>
                  </th>
                  <th className="p-8 font-medium">
                    <Trans>Stationary inaccuracy radius</Trans>
                  </th>
                  <th className="p-8 font-medium">
                    <Trans>Server tick interval</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {evidence.measurements.slice(0, limit).map((measurement, index) => (
                  <tr key={measurement.shotId} className="border-t border-gray-300">
                    <td className="p-8">#{index + 1}</td>
                    <td className="p-8">
                      {measurement.inaccuracy === null ? '—' : Number(measurement.inaccuracy.toFixed(6))}
                    </td>
                    <td className="p-8">{measurement.spread === null ? '—' : Number(measurement.spread.toFixed(6))}</td>
                    <td className="p-8">
                      {measurement.stationaryInaccuracy === null
                        ? '—'
                        : Number(measurement.stationaryInaccuracy.toFixed(6))}
                    </td>
                    <td className="p-8 whitespace-nowrap">
                      {measurement.firstServerTick ?? '—'} → {measurement.lastServerTick ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </details>
  );
}
