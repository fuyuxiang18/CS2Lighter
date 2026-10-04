import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans } from '@lingui/react/macro';
import type { PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { buildMatchPath } from 'csdm/ui/routes-paths';
import { HabitsPanel } from './habits-layout';
import { PersonalStatsPanels } from './personal-stats-panels';
import { ReviewButton } from './review-button';

export function ReviewMatches({ stats }: { stats: PersonalStatsSummary }) {
  const formatDate = useFormatDate();
  const getSource = useGetDemoSourceName();
  const [limit, setLimit] = useState(20);
  const [details, setDetails] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-20">
      <HabitsPanel title={<Trans>Your match notebook</Trans>}>
        <p className="text-gray-700">
          <Trans>
            Open a match for rounds, duels, utility and the full replay. The filters above also apply to these personal
            numbers.
          </Trans>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-caption whitespace-nowrap text-gray-700">
              <tr>
                <th className="p-12">
                  <Trans>Match</Trans>
                </th>
                <th className="p-12">
                  <Trans>Result</Trans>
                </th>
                <th className="p-12">
                  <Trans>K / D / A</Trans>
                </th>
                <th className="p-12">ADR</th>
                <th className="p-12">
                  <Trans>Headshot rate</Trans>
                </th>
                <th className="p-12">
                  <Trans>Review</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.matches.slice(0, limit).map((match) => (
                <tr key={match.checksum} className="border-t border-gray-300">
                  <td className="p-12">
                    <p className="text-body-strong">{match.mapName}</p>
                    <p className="mt-4 text-caption text-gray-700">
                      {formatDate(match.date)} · {getSource(match.source)}
                    </p>
                  </td>
                  <td className={`p-12 text-body-strong ${match.result === 'win' ? 'text-accent' : 'text-gray-700'}`}>
                    {match.result === 'win' ? (
                      <Trans>Win</Trans>
                    ) : match.result === 'loss' ? (
                      <Trans>Loss</Trans>
                    ) : match.result === 'tie' ? (
                      <Trans>Tie</Trans>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-12 whitespace-nowrap">
                    {match.metrics.kills} / {match.metrics.deaths} / {match.metrics.assists}
                  </td>
                  <td className="p-12">{match.metrics.adr?.toFixed(1) ?? '—'}</td>
                  <td className="p-12">
                    {match.metrics.headshotPercentage === null
                      ? '—'
                      : `${match.metrics.headshotPercentage.toFixed(1)}%`}
                  </td>
                  <td className="p-12 whitespace-nowrap">
                    <Link to={buildMatchPath(match.checksum)} className="text-accent">
                      <Trans>Open match</Trans> →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {limit < stats.matches.length && (
          <div>
            <ReviewButton onClick={() => setLimit(limit + 20)}>
              <Trans>Load more matches</Trans>
            </ReviewButton>
          </div>
        )}
      </HabitsPanel>
      <div className="flex flex-wrap items-center justify-between gap-12">
        <p className="text-gray-700">
          <Trans>Need the full numbers? Combat, utility, economy, weapons and trends are still here.</Trans>
        </p>
        <ReviewButton onClick={() => setDetails(!details)}>
          {details ? <Trans>Hide detailed statistics</Trans> : <Trans>Show detailed statistics</Trans>}
        </ReviewButton>
      </div>
      {details && <PersonalStatsPanels summary={stats} />}
    </div>
  );
}
