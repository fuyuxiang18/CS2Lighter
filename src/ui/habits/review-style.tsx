import React from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReviewInsightsSummary } from 'csdm/common/types/review-insights';
import type { PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import { RoutePath } from 'csdm/ui/routes-paths';
import { HabitsPanel } from './habits-layout';
import { useReviewLabels } from './use-review-labels';

export function ReviewStyle({ insights, stats }: { insights: ReviewInsightsSummary; stats: PersonalStatsSummary }) {
  const { t } = useLingui();
  const labels = useReviewLabels();
  const metrics = stats.metrics;
  const { ratingRoundCount, rwsRoundCount, rwsMissingRoundCount } = metrics;
  return (
    <div className="grid grid-cols-1 items-start gap-20 xl:grid-cols-2">
      <HabitsPanel title={<Trans>How you tend to play</Trans>}>
        <p className="text-gray-700">
          <Trans>
            These are proportions, not skill scores. Compare maps and sides before assigning yourself a role.
          </Trans>
        </p>
        {insights.style.map((dimension) => {
          const label = labels.style[dimension.id];
          const numerator = dimension.numerator;
          const denominator = dimension.denominator;
          return (
            <div key={dimension.id} className="flex flex-col gap-8 border-t border-gray-300 pt-16">
              <div className="flex items-baseline justify-between gap-12">
                <h3 className="text-body-strong">{label.title}</h3>
                <span className="text-heading text-accent tabular-nums">
                  {dimension.percentage === null ? '—' : `${dimension.percentage.toFixed(1)}%`}
                </span>
              </div>
              <div className="h-4 overflow-hidden rounded-full bg-gray-300">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, Math.max(0, dimension.percentage ?? 0))}%` }}
                />
              </div>
              <p className="text-caption text-gray-700">{label.detail}</p>
              <p className="text-caption text-gray-600">
                <Trans>
                  {numerator} / {denominator} observed
                </Trans>
                {dimension.sampleStatus === 'limited' && (
                  <>
                    {' '}
                    · <Trans>Small sample</Trans>
                  </>
                )}
              </p>
            </div>
          );
        })}
      </HabitsPanel>
      <div className="flex min-w-0 flex-col gap-20">
        <HabitsPanel title={<Trans>Your results, in context</Trans>}>
          <p className="text-gray-700">
            <Trans>Use these numbers to describe the sample, then return to rounds to understand your decisions.</Trans>
          </p>
          <div className="grid grid-cols-2 gap-16">
            {[
              { label: <Trans>K / D / A</Trans>, value: `${metrics.kills} / ${metrics.deaths} / ${metrics.assists}` },
              {
                label: <Trans>Headshot rate</Trans>,
                value: metrics.headshotPercentage === null ? '—' : `${metrics.headshotPercentage.toFixed(1)}%`,
              },
              { label: 'ADR', value: metrics.adr?.toFixed(1) ?? '—' },
              { label: 'KAST', value: metrics.kastPercentage === null ? '—' : `${metrics.kastPercentage.toFixed(1)}%` },
              {
                label: <Trans>Rating 1.0 · historical</Trans>,
                value: metrics.hltvRating1?.toFixed(2) ?? '—',
                detail: t`${ratingRoundCount} eligible rounds`,
              },
              {
                label: <Trans>RWS · public formula</Trans>,
                value: metrics.rws?.toFixed(2) ?? '—',
                detail: t`${rwsRoundCount} valid rounds · ${rwsMissingRoundCount} unavailable`,
              },
            ].map((item, index) => (
              <div key={index} className="flex flex-col gap-8 rounded-8 bg-gray-75 p-16">
                <p className="text-caption text-gray-700">{item.label}</p>
                <p className="text-subtitle tabular-nums">{item.value}</p>
                {item.detail && <p className="text-caption text-gray-600">{item.detail}</p>}
              </div>
            ))}
          </div>
          <p className="text-caption text-gray-600">
            <Trans>
              Rating uses the historical public 1.0 model. RWS uses the public damage/objective model; neither is an
              official platform score.
            </Trans>
          </p>
        </HabitsPanel>
        <HabitsPanel title={<Trans>Where does this style happen?</Trans>}>
          <p className="text-gray-700">
            <Trans>
              Explore opening positions and alive-time heatmaps. Select any occupied area to revisit example rounds.
            </Trans>
          </p>
          <Link
            to={RoutePath.HabitsMaps}
            className="self-start rounded-8 border border-accent-muted bg-accent-soft px-16 py-10 text-accent no-underline"
          >
            <Trans>Explore map habits</Trans> →
          </Link>
        </HabitsPanel>
      </div>
    </div>
  );
}
