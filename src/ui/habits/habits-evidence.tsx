import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { HabitsEvidence } from 'csdm/common/types/habits';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { Button } from 'csdm/ui/components/buttons/button';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { HabitsPlaybackButton } from './habits-playback-button';

function buildEvidencePath(checksum: string, roundNumber: number, steamId: string, tick?: number) {
  const search = new URLSearchParams({ player: steamId });
  if (tick !== undefined) search.set('tick', String(tick));
  return `${buildMatch2dViewerRoundPath(checksum, roundNumber)}?${search}`;
}

export function HabitsEvidenceList({ evidence, steamId }: { evidence: HabitsEvidence[]; steamId: string }) {
  const { t } = useLingui();
  const formatDate = useFormatDate();
  const [limit, setLimit] = useState(12);
  const labels: Record<HabitsEvidence['kind'], string> = {
    position: t`Position`,
    opening: t`Opening position`,
    kill: t`Kill`,
    death: t`Death`,
  };

  if (evidence.length === 0)
    return (
      <p className="text-gray-700">
        <Trans>No matching evidence yet.</Trans>
      </p>
    );

  return (
    <div className="flex flex-col gap-12">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-caption text-gray-700">
            <tr>
              <th className="p-8">
                <Trans>Match</Trans>
              </th>
              <th className="p-8">
                <Trans>Round</Trans>
              </th>
              <th className="p-8">
                <Trans>Event</Trans>
              </th>
              <th className="p-8">
                <Trans>Review</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {evidence.slice(0, limit).map((item, index) => (
              <tr
                key={`${item.checksum}-${item.roundNumber}-${item.tick}-${item.kind}-${index}`}
                className="border-t border-gray-300"
              >
                <td className="p-8">
                  <p>{item.mapName}</p>
                  <p className="text-caption text-gray-700">{formatDate(item.date)}</p>
                </td>
                <td className="p-8">
                  {item.roundNumber} · {item.side === TeamNumber.CT ? 'CT' : 'T'}
                </td>
                <td className="p-8">{labels[item.kind]}</td>
                <td className="p-8">
                  <div className="flex flex-wrap items-center gap-12">
                    <Link
                      className="text-blue-500"
                      to={buildEvidencePath(item.checksum, item.roundNumber, steamId, item.tick)}
                    >
                      <Trans>2D evidence</Trans>
                    </Link>
                    <HabitsPlaybackButton
                      checksum={item.checksum}
                      steamId={steamId}
                      tick={item.tick}
                      roundNumber={item.roundNumber}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit < evidence.length && (
        <Button onClick={() => setLimit((value) => value + 24)}>
          <Trans>Show more evidence</Trans>
        </Button>
      )}
    </div>
  );
}
