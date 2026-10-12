import React from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { DeathRiskEvidence, DeathRiskFinding, DeathRiskReport } from 'csdm/common/types/death-risk';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { deathRiskPresentation } from './death-review-presentation';
import { useDeathRiskCopy } from './use-death-risk-copy';

function RiskEvidenceLink({ record, tick }: { record: DeathReviewRecord; tick: number }) {
  if (record.roundNumber <= 0 || !Number.isSafeInteger(tick) || tick < 0) return null;
  const offset = ((tick - record.eventTick) / record.tickrate).toFixed(2);
  const path = `${buildMatch2dViewerRoundPath(record.checksum, record.roundNumber)}?${new URLSearchParams({ player: record.steamId, tick: String(tick) })}`;
  return (
    <Link to={path} className="shrink-0 rounded-4 bg-accent-soft px-8 py-4 text-caption text-accent">
      <Trans>Locate {offset} s</Trans>
    </Link>
  );
}

function Evidence({
  evidence,
  record,
  target,
}: {
  evidence: DeathRiskEvidence;
  record: DeathReviewRecord;
  target: string | null;
}) {
  const copy = useDeathRiskCopy();
  return (
    <li className="flex min-w-0 flex-col gap-8 rounded-8 bg-gray-75 p-12">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <p className="text-body-strong">
          {copy.evidenceTitles[evidence.code] ?? copy.evidenceTitles.observation}
          {target && ` · ${target}`}
        </p>
        <RiskEvidenceLink record={record} tick={evidence.tick} />
      </div>
      <dl className="flex flex-wrap gap-x-16 gap-y-8">
        {Object.entries(evidence.values)
          .filter(([key, value]) => value !== null && !key.endsWith('Id'))
          .map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-caption text-gray-700">{copy.measureLabels[key] ?? key}</dt>
              <dd className="text-body wrap-anywhere tabular-nums">
                {key.endsWith('Tick') && typeof value === 'number'
                  ? `${((value - record.eventTick) / record.tickrate).toFixed(2)} s`
                  : copy.formatValue(key, value)}
              </dd>
            </div>
          ))}
      </dl>
    </li>
  );
}

function RiskCard({
  finding,
  record,
  primary,
}: {
  finding: DeathRiskFinding;
  record: DeathReviewRecord;
  primary: boolean;
}) {
  const { t } = useLingui();
  const copy = useDeathRiskCopy();
  const title = copy.titles[finding.ruleId];
  const evidence = finding.evidence.toSorted((a, b) => a.tick - b.tick);
  const otherTargets = [
    ...new Set(
      evidence.flatMap((item) => (item.targetId && item.targetId !== record.killerSteamId ? [item.targetId] : [])),
    ),
  ];
  const targetLabel = (id: string | undefined) => {
    if (!id) return null;
    if (id === record.killerSteamId) return record.killerName || t`Killer`;
    const number = otherTargets.indexOf(id) + 1;
    return t`Opponent ${number}`;
  };
  return (
    <article
      className={`flex min-w-0 flex-col gap-12 rounded-8 border p-16 ${primary ? 'border-accent-muted bg-accent-soft' : 'border-gray-300 bg-gray-100'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0">
          <p className="mb-4 text-caption font-semibold text-accent">
            {primary ? <Trans>First improvement</Trans> : <Trans>Additional risk</Trans>}
          </p>
          <h4 className="text-subtitle">{title}</h4>
          {(finding.ruleId === 'r12' || finding.ruleId === 'r13') && (
            <p className="mt-4 text-caption text-gray-700">
              {finding.ruleId === 'r12' || finding.relatedRuleIds.includes('r12') ? (
                <Trans>Your own flash</Trans>
              ) : null}
              {finding.relatedRuleIds.some((ruleId) => ruleId === 'r12' || ruleId === 'r13') ? ' · ' : null}
              {finding.ruleId === 'r13' || finding.relatedRuleIds.includes('r13') ? (
                <Trans>Advanced while flashed</Trans>
              ) : null}
            </p>
          )}
        </div>
        <RiskEvidenceLink record={record} tick={finding.startTick} />
      </div>
      <ol className="flex min-w-0 flex-col gap-8">
        {evidence.map((item, index) => (
          <Evidence
            key={`${item.code}:${item.tick}:${index}`}
            evidence={item}
            record={record}
            target={targetLabel(item.targetId)}
          />
        ))}
      </ol>
      <div className="border-l border-accent-muted pl-12">
        <h5 className="mb-4 text-caption font-semibold text-accent">
          <Trans>Next time</Trans>
        </h5>
        <p className="text-body text-gray-900">{copy.advice[finding.advice.code]}</p>
      </div>
    </article>
  );
}

export function DeathRiskPanel({ report, record }: { report: DeathRiskReport | undefined; record: DeathReviewRecord }) {
  const presentation = deathRiskPresentation(report);
  if (presentation.status === 'risks')
    return (
      <div className="flex min-w-0 flex-col gap-12">
        {presentation.findings.map((finding, index) => (
          <RiskCard key={finding.id} finding={finding} record={record} primary={index === 0} />
        ))}
      </div>
    );
  return (
    <p className="rounded-8 bg-gray-75 p-16 text-body">
      {presentation.status === 'not-analyzed' ? (
        <Trans>
          These saved traces have not been checked with the new operation rules. Run the operation review to add
          conclusions.
        </Trans>
      ) : presentation.status === 'not-applicable' ? (
        <Trans>The operation rules do not apply to this death.</Trans>
      ) : presentation.status === 'insufficient' ? (
        <Trans>There is not enough evidence for an operation conclusion.</Trans>
      ) : presentation.status === 'partial-clear' ? (
        <Trans>No clear operation risk was found in the items that could be checked.</Trans>
      ) : (
        <Trans>No clear operation risk was found in this death.</Trans>
      )}
    </p>
  );
}

export function DeathRiskCoverage({ report }: { report: DeathRiskReport }) {
  const copy = useDeathRiskCopy();
  return (
    <div className="flex flex-col gap-8">
      {report.evaluations.map((evaluation) => (
        <div key={evaluation.ruleId} className="rounded-8 bg-gray-75 p-12">
          <div className="flex flex-wrap items-center justify-between gap-8 text-body">
            <span>
              {evaluation.ruleId.toUpperCase()} · {copy.titles[evaluation.ruleId]}
            </span>
            <span className="text-caption text-gray-700">{copy.statuses[evaluation.status]}</span>
          </div>
          {evaluation.reasons.length > 0 && (
            <ul className="mt-8 flex flex-col gap-4 text-caption text-gray-700">
              {evaluation.reasons.map((reason) => (
                <li key={reason}>{copy.reasons[reason] ?? reason}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
