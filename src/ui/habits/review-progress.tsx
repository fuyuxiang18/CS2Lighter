import React, { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { ReviewInsightsSummary } from 'csdm/common/types/review-insights';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { useGetGameModeTranslation } from 'csdm/ui/hooks/use-get-game-mode-translation';
import { Select } from 'csdm/ui/components/inputs/select';
import { HabitsPanel } from './habits-layout';
import { ReviewButton } from './review-button';
import { useReviewLabels } from './use-review-labels';
import type { ReviewPreferences } from './review-storage';

export function ReviewProgress({
  insights,
  preferences,
  update,
}: {
  insights: ReviewInsightsSummary;
  preferences: ReviewPreferences;
  update: (patch: Partial<ReviewPreferences>) => void;
}) {
  const { t } = useLingui();
  const labels = useReviewLabels();
  const formatDate = useFormatDate();
  const getSource = useGetDemoSourceName();
  const getMode = useGetGameModeTranslation();
  const [comparisonKey, setComparisonKey] = useState('');
  const comparison = insights.comparisons.find((item) => item.key === comparisonKey) ?? insights.comparisons[0];
  const focus = preferences.focus;
  const training = insights.training;
  return (
    <div className="flex min-w-0 flex-col gap-20">
      <HabitsPanel title={<Trans>One action for the next matches</Trans>}>
        {focus ? (
          <>
            <div className="rounded-8 border border-accent-muted bg-accent-soft p-20">
              <p className="text-subtitle wrap-anywhere">{focus.action}</p>
              <p className="mt-8 text-caption text-gray-700">
                {focus.scope.mapName} · {focus.scope.side === TeamNumber.CT ? 'CT' : 'T'} ·{' '}
                {getSource(focus.scope.source)} · {getMode(focus.scope.gameMode)} · {focus.scope.buildNumber}
              </p>
              <p className="mt-4 text-caption text-gray-700">
                <Trans>Started</Trans> {formatDate(focus.scope.startedAt)}
              </p>
            </div>
            <p className="text-body-strong">{labels.cards[focus.scope.cardId].title}</p>
            {training && (
              <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
                {[
                  { label: t`Before this practice`, value: training.earlier },
                  { label: t`Matches played after starting`, value: training.recent },
                ].map(({ label, value }) => {
                  const matches = value.matchCount;
                  const rounds = value.roundCount;
                  return (
                    <div key={label} className="rounded-8 border border-gray-300 bg-gray-75 p-20">
                      <p className="text-caption text-gray-700">{label}</p>
                      <p className="mt-8 text-display tabular-nums">
                        {value.denominator > 0 ? `${value.percentage?.toFixed(1)}%` : '—'}
                      </p>
                      <p className="mt-8 text-caption text-gray-700">
                        {value.occurrenceCount} / {value.denominator} ·{' '}
                        <Trans>
                          {matches} matches · {rounds} rounds
                        </Trans>
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-gray-700">
              {training?.sampleStatus === 'ready' ? (
                <Trans>
                  You now have comparable samples. Revisit the rounds and judge whether your chosen action helped; a
                  percentage change alone does not prove improvement.
                </Trans>
              ) : (
                <Trans>
                  Keep the same focus. A comparison needs at least two matches and twenty rounds on each side, plus
                  enough relevant situations.
                </Trans>
              )}
            </p>
            <p className="text-caption text-gray-600">
              <Trans>
                Only matches played after the start time count as practice results. Importing an old demo does not
                create progress. Each period uses up to five matches in this exact scenario.
              </Trans>
            </p>
            <div className="flex flex-wrap gap-8">
              <ReviewButton
                onClick={() =>
                  update({
                    tab: 'review',
                    mapName: focus.scope.mapName,
                    side: focus.scope.side === TeamNumber.CT ? 'ct' : 't',
                    source: focus.scope.source,
                    selectedCard: focus.scope.cardId,
                  })
                }
              >
                <Trans>Review more evidence</Trans>
              </ReviewButton>
              <ReviewButton onClick={() => update({ focus: null })}>
                <Trans>End this focus</Trans>
              </ReviewButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-700">
              <Trans>
                Watch a candidate round first, then choose one concrete action. We will compare later matches with the
                same map, side, source, mode and game build.
              </Trans>
            </p>
            <div>
              <ReviewButton primary={true} onClick={() => update({ tab: 'review' })}>
                <Trans>Choose from review candidates</Trans>
              </ReviewButton>
            </div>
          </>
        )}
      </HabitsPanel>
      <HabitsPanel title={<Trans>Recent play versus your earlier play</Trans>}>
        <p className="text-gray-700">
          <Trans>
            This is a self comparison, not a rank or a training score. Maps, sides, sources, modes and game builds are
            kept separate.
          </Trans>
        </p>
        {comparison ? (
          <>
            <div className="flex min-w-0 flex-col gap-4">
              <Select
                label={t`Comparable scenario`}
                value={comparison.key}
                onChange={setComparisonKey}
                options={insights.comparisons.map((item) => ({
                  value: item.key,
                  label: `${item.mapName} · ${item.side === TeamNumber.CT ? 'CT' : 'T'} · ${getSource(item.source)} · ${getMode(item.gameMode)} · ${item.buildNumber}`,
                }))}
              />
            </div>
            <div className="flex flex-wrap gap-16 text-caption text-gray-700">
              <p>
                <Trans>Earlier sample</Trans>: {comparison.earlier.matchCount} <Trans>matches</Trans> /{' '}
                {comparison.earlier.roundCount} <Trans>rounds</Trans>
                {comparison.earlier.startDate && (
                  <>
                    {' '}
                    · {formatDate(comparison.earlier.startDate)} –{' '}
                    {formatDate(comparison.earlier.endDate ?? comparison.earlier.startDate)}
                  </>
                )}
              </p>
              <p>
                <Trans>Recent sample</Trans>: {comparison.recent.matchCount} <Trans>matches</Trans> /{' '}
                {comparison.recent.roundCount} <Trans>rounds</Trans>
                {comparison.recent.startDate && (
                  <>
                    {' '}
                    · {formatDate(comparison.recent.startDate)} –{' '}
                    {formatDate(comparison.recent.endDate ?? comparison.recent.startDate)}
                  </>
                )}
              </p>
            </div>
            {comparison.sampleStatus === 'insufficient' && (
              <p className="rounded-8 bg-gray-75 p-12 text-gray-700">
                <Trans>
                  Not enough comparable matches yet. Values remain visible as observations; changes are withheld until
                  the sample is large enough.
                </Trans>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="text-caption text-gray-700">
                  <tr>
                    <th className="p-12">
                      <Trans>Behavior / result</Trans>
                    </th>
                    <th className="p-12">
                      <Trans>Earlier</Trans>
                    </th>
                    <th className="p-12">
                      <Trans>Recent</Trans>
                    </th>
                    <th className="p-12">
                      <Trans>Change</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.metrics.map((metric) => (
                    <tr key={metric.id} className="border-t border-gray-300">
                      <td className="p-12">{labels.trends[metric.id]}</td>
                      <td className="p-12">
                        {metric.earlier.value?.toFixed(1) ?? '—'}
                        {metric.earlier.value !== null && metric.unit === 'percent' && '%'}
                      </td>
                      <td className="p-12">
                        {metric.recent.value?.toFixed(1) ?? '—'}
                        {metric.recent.value !== null && metric.unit === 'percent' && '%'}
                      </td>
                      <td className="p-12 text-gray-700">
                        {metric.delta === null
                          ? '—'
                          : `${metric.delta > 0 ? '+' : ''}${metric.delta.toFixed(1)} ${metric.unit === 'percent' ? t`pp` : ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-caption text-gray-600">
              <Trans>
                Up to five recent matches versus the previous five. Each period needs at least two matches and twenty
                rounds; rare events need additional samples. A dash means insufficient evidence.
              </Trans>
            </p>
          </>
        ) : (
          <p className="text-gray-700">
            <Trans>No comparable scenario in this selection.</Trans>
          </p>
        )}
      </HabitsPanel>
    </div>
  );
}
