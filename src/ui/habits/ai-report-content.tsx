import React from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { AiEvidence, AiReport, AiScoreDimension } from 'csdm/common/types/ai';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { ReviewClipButton } from './review-clip-viewer';

function EvidenceLinks({ ids, evidence }: { ids: string[]; evidence: AiEvidence[] }) {
  const { t } = useLingui();
  const selected = evidence.filter((item) => ids.includes(item.id));
  const count = selected.length;

  if (selected.length === 0) return null;

  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-caption text-accent">
        <Trans>View evidence ({count})</Trans>
      </summary>
      <div className="mt-8 flex flex-col gap-8" aria-label={t`Supporting rounds`}>
        {selected.map((item) => {
          const query = new URLSearchParams({ player: item.steamId, tick: String(item.tick) });
          const round = item.roundNumber;
          const side = item.side === TeamNumber.CT ? 'CT' : 'T';
          return (
            <div
              key={item.id}
              className="flex min-w-0 flex-wrap items-center gap-8 rounded-8 border border-gray-300 p-8"
            >
              <Link
                to={`${buildMatch2dViewerRoundPath(item.checksum, round)}?${query}`}
                className="min-w-0 rounded-8 px-10 py-8 text-caption wrap-break-word text-accent hover:bg-accent-soft"
                title={
                  item.precision === 'round-start'
                    ? t`Opens the round start. The model did not locate an exact decision moment.`
                    : t`Opens the event context in the 2D viewer. Verify the interpretation in the round.`
                }
              >
                {item.mapName} · <Trans>Round {round}</Trans> · {side}
                {item.precision === 'round-start' && (
                  <span className="text-gray-700">
                    {' '}
                    · <Trans>Round start</Trans>
                  </span>
                )}
              </Link>
              <ReviewClipButton
                request={{ checksum: item.checksum, steamId: item.steamId, roundNumber: round, startTick: item.tick }}
              />
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function AiReportContent({ report }: { report: AiReport }) {
  const { t } = useLingui();
  const { content, evidence } = report;
  const scoreLabels: Record<AiScoreDimension, string> = {
    aim: t`Aim`,
    opening: t`Entry`,
    trading: t`Trading`,
    utility: t`Utility`,
    clutch: t`Clutches`,
  };
  const scoreOrder: AiScoreDimension[] = ['aim', 'opening', 'trading', 'utility', 'clutch'];

  return (
    <div className="flex min-w-0 flex-col gap-20">
      <div className="flex min-w-0 flex-col gap-10 rounded-12 border border-accent-muted bg-accent-soft p-16">
        <h3 className="font-semibold">
          <Trans>Your style in this sample</Trans>
        </h3>
        <p className="text-heading font-semibold wrap-break-word text-accent">{content.style.label}</p>
        <p className="wrap-break-word whitespace-pre-wrap text-gray-800">{content.style.text}</p>
        <EvidenceLinks ids={content.style.evidenceIds} evidence={evidence} />
      </div>

      <section className="flex min-w-0 flex-col gap-12" aria-label={t`Five-dimension assessment`}>
        <h3 className="font-semibold">
          <Trans>Five-dimension assessment</Trans>
        </h3>
        <p className="text-caption text-gray-700">
          <Trans>
            AI scores describe this sample on a subjective 0–100 scale. They are not calibrated ranks or percentiles.
          </Trans>
        </p>
        <div className="grid grid-cols-1 items-start gap-12 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {scoreOrder.map((dimension) => {
            const item = content.scores.find((score) => score.dimension === dimension);
            const score = item?.score ?? null;
            return (
              <div
                key={dimension}
                className="flex min-w-0 flex-col gap-10 rounded-8 border border-gray-300 bg-gray-75 p-16"
              >
                <h4 className="font-semibold">{scoreLabels[dimension]}</h4>
                <p className="flex min-h-40 flex-wrap items-baseline gap-4 tabular-nums">
                  {score === null ? (
                    <span className="text-body-strong text-gray-700">
                      <Trans>Insufficient data</Trans>
                    </span>
                  ) : (
                    <>
                      <span className="text-heading font-semibold text-accent">{score}</span>
                      <span className="text-caption text-gray-600">/ 100</span>
                    </>
                  )}
                </p>
                {item && (
                  <p className="text-caption wrap-break-word whitespace-pre-wrap text-gray-800">{item.rationale}</p>
                )}
                {item && <EvidenceLinks ids={item.evidenceIds} evidence={evidence} />}
              </div>
            );
          })}
        </div>
        <p className="text-caption text-gray-700">
          <Trans>
            Aim estimates shooting results from statistics. It does not measure pre-aim, recoil control or mouse
            movement.
          </Trans>
        </p>
      </section>

      <div className="flex flex-col gap-10">
        <h3 className="font-semibold">
          <Trans>The main takeaway</Trans>
        </h3>
        <p className="wrap-break-word whitespace-pre-wrap">{content.summary.text}</p>
        <EvidenceLinks ids={content.summary.evidenceIds} evidence={evidence} />
      </div>

      {content.recommendations.length > 0 && (
        <div className="flex flex-col gap-12">
          <h3 className="font-semibold">
            <Trans>Actions to try next</Trans>
          </h3>
          <p className="text-caption text-gray-700">
            <Trans>
              Choose one action for your next matches, then revisit the same situations to check what changed.
            </Trans>
          </p>
          <ol className="grid gap-12 lg:grid-cols-2">
            {content.recommendations.map((item, index) => (
              <li key={index} className="flex min-w-0 flex-col gap-10 rounded-8 border border-gray-300 p-16">
                <h4 className="font-semibold wrap-break-word">
                  <span className="text-accent">{index + 1}. </span>
                  {item.title}
                </h4>
                <p className="wrap-break-word whitespace-pre-wrap">{item.action}</p>
                <p className="text-caption wrap-break-word whitespace-pre-wrap text-gray-700">{item.uncertainty}</p>
                <EvidenceLinks ids={item.evidenceIds} evidence={evidence} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {content.observations.length > 0 && (
        <div className="flex flex-col gap-12">
          <h3 className="font-semibold">
            <Trans>Situations worth checking</Trans>
          </h3>
          {content.observations.map((item, index) => (
            <div key={index} className="flex flex-col gap-10 border-l border-gray-300 pl-16">
              <p className="wrap-break-word whitespace-pre-wrap text-gray-800">{item.text}</p>
              <EvidenceLinks ids={item.evidenceIds} evidence={evidence} />
            </div>
          ))}
        </div>
      )}

      <details className="rounded-8 border border-gray-300 p-16">
        <summary className="cursor-pointer font-semibold">
          <Trans>Limited assessments and missing evidence</Trans>
        </summary>
        <p className="mt-12 text-caption text-gray-700">
          <Trans>
            Scores are the model's subjective assessment of this sample on a 0–100 scale. They are not a rank, a
            percentile or a calibrated measure of improvement. Opponents and roles are not controlled.
          </Trans>
        </p>
        {content.limitations.length > 0 && (
          <ul className="mt-16 flex list-disc flex-col gap-8 pl-20 text-caption text-gray-700">
            {content.limitations.map((item, index) => (
              <li key={index} className="wrap-break-word whitespace-pre-wrap">
                {item}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
