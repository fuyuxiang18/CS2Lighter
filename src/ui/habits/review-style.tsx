import React from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReviewInsightsSummary, StyleDimension } from 'csdm/common/types/review-insights';
import { RoutePath } from 'csdm/ui/routes-paths';
import { useReviewLabels } from './use-review-labels';

function StyleSummary({ dimension }: { dimension: StyleDimension }) {
  const { t } = useLingui();
  const { numerator, denominator } = dimension;
  const summaries: Record<StyleDimension['id'], string> = {
    'opening-participation': t`You were involved in the first elimination in ${numerator} of ${denominator} rounds.`,
    'trade-kill-share': t`${numerator} of your ${denominator} enemy kills were five-second trades.`,
    'utility-round-share': t`You threw utility in ${numerator} of ${denominator} rounds.`,
    survival: t`You stayed alive through ${numerator} of ${denominator} rounds.`,
    'clutch-exposure': t`You reached a 1vX situation in ${numerator} of ${denominator} rounds.`,
  };
  return <p className="text-body text-gray-800">{summaries[dimension.id]}</p>;
}

export function ReviewStyle({ insights }: { insights: ReviewInsightsSummary }) {
  const { t } = useLingui();
  const labels = useReviewLabels();
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
      <div className="flex flex-wrap items-center justify-between gap-12">
        <h2 className="text-subtitle font-semibold">
          <Trans>Playing habits</Trans>
        </h2>
        <Link to={RoutePath.HabitsMaps} className="text-caption text-accent">
          <Trans>Explore map habits</Trans> →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-16 sm:grid-cols-2 xl:grid-cols-3">
        {insights.style.map((dimension) => (
          <div key={dimension.id} className="flex min-w-0 flex-col gap-10 rounded-8 bg-gray-75 p-16">
            <div className="flex items-start justify-between gap-8">
              <h3 className="text-body-strong" title={labels.style[dimension.id].detail}>
                {labels.style[dimension.id].title}
              </h3>
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
            <span
              className="text-caption text-gray-700 tabular-nums"
              title={dimension.sampleStatus === 'limited' ? t`Small sample` : undefined}
            >
              {dimension.numerator} / {dimension.denominator}
            </span>
            <StyleSummary dimension={dimension} />
          </div>
        ))}
      </div>
      <details className="border-t border-gray-300 pt-12">
        <summary className="cursor-pointer text-caption text-gray-700">
          <Trans>Calculation details</Trans>
        </summary>
        <dl className="mt-12 flex flex-col gap-12 text-caption text-gray-700">
          {insights.style.map((dimension) => (
            <div key={dimension.id}>
              <dt className="font-semibold">{labels.style[dimension.id].title}</dt>
              <dd>{labels.style[dimension.id].detail}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
