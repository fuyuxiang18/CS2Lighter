import React, { type ReactNode } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type {
  PersonalAchievementCode,
  PersonalAnalysis,
  PersonalAnalysisEvidence,
  PersonalAverage,
  PersonalFindingCode,
  PersonalRate,
} from 'csdm/common/types/personal-analysis';
import type { PersonalStatsGroup, PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { HabitsPanel } from './habits-layout';

type Section = 'overview' | 'combat' | 'utility' | 'clutch' | 'matches' | 'records';

function Metric({ label, value, sample }: { label: ReactNode; value: ReactNode; sample?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-8 bg-gray-75 p-16">
      <p className="text-caption text-gray-700">{label}</p>
      <p className="text-heading font-semibold tabular-nums">{value}</p>
      {sample && <span className="text-caption text-gray-700 tabular-nums">{sample}</span>}
    </div>
  );
}

function Rate({ label, rate }: { label: ReactNode; rate: PersonalRate }) {
  return (
    <Metric
      label={label}
      value={rate.percentage === null ? '—' : `${rate.percentage.toFixed(1)}%`}
      sample={`${rate.count} / ${rate.total}`}
    />
  );
}

function Average({ label, average }: { label: ReactNode; average: PersonalAverage }) {
  return (
    <Metric
      label={label}
      value={average.value?.toFixed(1) ?? '—'}
      sample={`${Number(average.total.toFixed(1))} / ${average.samples}`}
    />
  );
}

function Evidence({ items, steamId }: { items: PersonalAnalysisEvidence[]; steamId: string }) {
  if (items.length === 0) return null;
  return (
    <details className="text-caption">
      <summary className="cursor-pointer text-accent">
        <Trans>Example rounds</Trans>
      </summary>
      <div className="mt-8 flex flex-wrap gap-8">
        {items.map((item) => {
          const query = new URLSearchParams({ player: steamId, tick: String(item.tick) });
          const round = item.roundNumber;
          return (
            <Link
              key={`${item.checksum}:${round}`}
              to={`${buildMatch2dViewerRoundPath(item.checksum, round)}?${query}`}
              className="rounded-8 border border-accent-muted px-10 py-8 text-accent hover:bg-accent-soft"
            >
              {item.mapName} · <Trans>Round {round}</Trans> · {item.side === TeamNumber.CT ? 'CT' : 'T'}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function FindingCopy({ finding }: { finding: PersonalAnalysis['findings'][number] }) {
  const { t } = useLingui();
  const { count, total } = finding;
  const copy: Record<PersonalFindingCode, { summary: string; action: string }> = {
    'opening-conversion': {
      summary: t`${count} of your ${total} opening-kill rounds ended in a loss.`,
      action: t`Check the next engagement between your first kill and the loss of the player advantage. Plan that fight around keeping the advantage.`,
    },
    'untraded-deaths': {
      summary: t`No teammate traded your death within five seconds in ${count} of ${total} death rounds.`,
      action: t`Check whether a teammate could reach the same firing angle. Before the next entry, agree on a position and timing that allow a trade.`,
    },
    'team-flashes': {
      summary: t`Your flashes blinded a teammate for more than one second in ${count} of ${total} rounds.`,
      action: t`Compare the throw timing with your teammate's view. Call the next flash before throwing and leave time to turn away.`,
    },
    'zero-utility': {
      summary: t`No grenade throw was recorded in ${count} of ${total} rounds.`,
      action: t`Check your available grenades before first contact. Pick one useful throw for your route and a safe moment to use it.`,
    },
    'multi-kill-rounds': {
      summary: t`You made at least two kills in ${count} of ${total} rounds.`,
      action: t`Replay the gap between the first and second kills. Note the repositioning, cover and teammate support you can repeat.`,
    },
    'clutch-wins': {
      summary: t`You won ${count} of ${total} recorded clutches.`,
      action: t`Compare the clock, opponent count and first isolated fight in these wins. Keep one repeatable decision for a similar clutch.`,
    },
    'flash-assists': {
      summary: t`You recorded a flash assist in ${count} of ${total} rounds.`,
      action: t`Revisit the successful throw and your teammate's entry timing. Agree on the same cue for the next attempt.`,
    },
  };
  const selected = copy[finding.code];
  return (
    <>
      <p className="text-body text-gray-800">{selected.summary}</p>
      <div className="border-l border-accent-muted pl-12 text-body text-gray-800">
        <p className="mb-4 text-caption font-semibold text-accent">
          <Trans>Next step</Trans>
        </p>
        <p>{selected.action}</p>
      </div>
    </>
  );
}

export function PersonalAnalysisPanels({ summary, section }: { summary: PersonalStatsSummary; section: Section }) {
  const { t } = useLingui();
  const formatDate = useFormatDate();
  const { analysis } = summary;
  const { output, survival, opening, utility, trend, stability, streaks } = analysis;
  const recentAdr = trend.recent?.metrics.adr ?? null;
  const previousAdr = trend.previous?.metrics.adr ?? null;
  const adrDelta = recentAdr === null || previousAdr === null ? null : recentAdr - previousAdr;
  const adrChange = adrDelta === null ? '—' : `${adrDelta > 0 ? '+' : ''}${adrDelta.toFixed(1)}`;
  const findingLabels: Record<PersonalFindingCode, string> = {
    'opening-conversion': t`Lost rounds after an opening kill`,
    'untraded-deaths': t`Death rounds without a trade`,
    'team-flashes': t`Rounds with friendly flashes`,
    'zero-utility': t`Rounds without a grenade thrown`,
    'multi-kill-rounds': t`Rounds with multiple kills`,
    'clutch-wins': t`Clutches won`,
    'flash-assists': t`Rounds with a flash assist`,
  };
  const achievementLabels: Record<PersonalAchievementCode, string> = {
    ace: t`Ace rounds`,
    'four-kill': t`Four-kill rounds`,
    'triple-kill': t`Triple-kill rounds`,
    'clutch-win': t`Last player standing`,
    'utility-multi-kill': t`Multiple utility kills`,
    'knife-kill': t`Rounds with a knife kill`,
    'damage-300': t`300 damage club`,
    'damage-without-kill': t`Damage without the finish`,
    'double-trade': t`Double trade`,
    'double-flash-assist': t`Flash assist double`,
    'awp-triple': t`AWP triple`,
    'low-equipment-multi': t`Budget multi-kill`,
    'bomb-plant': t`Bomb planted`,
    'bomb-defuse': t`Defuse secured`,
    'clutch-1v3': t`Against the odds: 1v3+`,
  };
  const achievementDefinitions: Record<PersonalAchievementCode, string> = {
    ace: t`Exactly five enemy kills in a round.`,
    'four-kill': t`Exactly four enemy kills in a round.`,
    'triple-kill': t`Exactly three enemy kills in a round.`,
    'clutch-win': t`Won a recorded 1vX situation.`,
    'utility-multi-kill': t`At least two HE or fire kills in a round.`,
    'knife-kill': t`At least one knife kill in a round.`,
    'damage-300': t`At least 300 enemy health damage in a round.`,
    'damage-without-kill': t`At least 100 enemy health damage and no kills in a round.`,
    'double-trade': t`At least two trade kills in a round.`,
    'double-flash-assist': t`At least two flash assists in a round.`,
    'awp-triple': t`At least three AWP kills in a round.`,
    'low-equipment-multi': t`At least two kills with recorded starting equipment worth 2000 or less.`,
    'bomb-plant': t`Planted the bomb in the round.`,
    'bomb-defuse': t`Defused the bomb in the round.`,
    'clutch-1v3': t`Won a clutch that started against three or more opponents.`,
  };
  if (analysis.scope.roundCount === 0)
    return (
      <p className="rounded-8 bg-gray-100 p-16 text-gray-700">
        <Trans>No standard 5v5 rounds in this selection.</Trans>
      </p>
    );
  return (
    <div className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap items-center gap-8 text-caption text-gray-700">
        <span className="rounded-4 bg-accent-soft px-8 py-4 font-semibold text-accent">
          <Trans>5v5 analysis</Trans>
        </span>
        <span>
          {analysis.scope.matchCount} <Trans>matches</Trans> · {analysis.scope.roundCount} <Trans>rounds</Trans>
        </span>
        {analysis.scope.excludedMatchCount > 0 && (
          <span>
            · {analysis.scope.excludedMatchCount} <Trans>nonstandard matches excluded</Trans>
          </span>
        )}
      </div>
      {section === 'overview' && (
        <div className="grid grid-cols-1 items-start gap-16 xl:grid-cols-2">
          {(['strength', 'focus'] as const).map((kind) => (
            <HabitsPanel
              key={kind}
              title={kind === 'strength' ? <Trans>Recorded highlights</Trans> : <Trans>Where to look next</Trans>}
            >
              {analysis.findings
                .filter((item) => item.kind === kind)
                .map((item) => (
                  <article key={item.code} className="flex min-w-0 flex-col gap-10 border-t border-gray-300 pt-12">
                    <div className="flex flex-wrap items-center justify-between gap-8">
                      <h3 className="text-body-strong">{findingLabels[item.code]}</h3>
                      <span className="text-heading text-accent tabular-nums">
                        {item.total > 0 ? `${((100 * item.count) / item.total).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                    <span className="text-caption text-gray-700 tabular-nums">
                      {item.count} / {item.total}
                    </span>
                    <FindingCopy finding={item} />
                    <Evidence items={item.evidence} steamId={summary.steamId} />
                  </article>
                ))}
              {!analysis.findings.some((item) => item.kind === kind) && (
                <p className="text-gray-700">
                  <Trans>No matching review patterns in this selection.</Trans>
                </p>
              )}
            </HabitsPanel>
          ))}
        </div>
      )}
      {section === 'combat' && (
        <>
          <HabitsPanel title={<Trans>Output across rounds</Trans>}>
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
              <Average label={<Trans>Non-utility damage per round</Trans>} average={output.nonUtilityDamage} />
              <Rate label={<Trans>Rounds with a kill</Trans>} rate={output.killRounds} />
              <Rate label={<Trans>Rounds with a kill or assist</Trans>} rate={output.killOrAssistRounds} />
              <Rate label={<Trans>100+ damage rounds</Trans>} rate={output.damage100Rounds} />
              <Rate label={<Trans>Zero-damage rounds</Trans>} rate={output.zeroDamageRounds} />
              <Rate label={<Trans>Multi-kill round rate</Trans>} rate={output.multiKillRounds} />
            </div>
          </HabitsPanel>
          <HabitsPanel title={<Trans>After the opening duel</Trans>}>
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
              <Rate label={<Trans>Survived after an opening kill</Trans>} rate={opening.survivedOpeningKillRounds} />
              <Rate label={<Trans>Team wins after your opening death</Trans>} rate={opening.winAfterOpeningDeath} />
              <Rate
                label={<Trans>Wins without a personal opening event</Trans>}
                rate={opening.winWithoutOpeningEvent}
              />
            </div>
          </HabitsPanel>
        </>
      )}
      {section === 'utility' && (
        <HabitsPanel title={<Trans>Utility use and efficiency</Trans>}>
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
            <Rate label={<Trans>Rounds with utility thrown</Trans>} rate={utility.usedUtilityRounds} />
            <Rate label={<Trans>Rounds with a flash assist</Trans>} rate={utility.flashAssistRounds} />
            <Rate label={<Trans>Rounds with friendly flashes</Trans>} rate={utility.teammateFlashRounds} />
            <Average label={<Trans>Damage per HE or fire grenade</Trans>} average={utility.damagePerHeOrFire} />
            <Average label={<Trans>Enemy blind seconds per flash</Trans>} average={utility.blindSecondsPerFlash} />
            <Average label={<Trans>Enemies blinded per flash</Trans>} average={utility.enemiesPerFlash} />
            <Average label={<Trans>Teammates blinded per flash</Trans>} average={utility.teammatesPerFlash} />
          </div>
        </HabitsPanel>
      )}
      {section === 'clutch' && (
        <>
          <HabitsPanel title={<Trans>Survival and round outcome</Trans>}>
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
              <Rate label={<Trans>Survived winning rounds</Trans>} rate={survival.survivedWinRounds} />
              <Rate label={<Trans>Survived losing rounds</Trans>} rate={survival.survivedLossRounds} />
              <Rate label={<Trans>Death rounds without a trade</Trans>} rate={survival.untradedDeathRounds} />
              <Rate
                label={<Trans>Deaths without damage, kills or assists</Trans>}
                rate={survival.noImpactDeathRounds}
              />
            </div>
          </HabitsPanel>
          <AnalysisGroupTable title={<Trans>Winning versus losing rounds</Trans>} groups={analysis.byRoundResult} />
          <AnalysisGroupTable title={<Trans>Performance through a match</Trans>} groups={analysis.byPhase} />
        </>
      )}
      {section === 'matches' && (
        <>
          {trend.recent && trend.previous && (
            <HabitsPanel title={<Trans>Your two latest match windows</Trans>}>
              {trend.comparable && adrDelta !== null && (
                <p className="rounded-8 bg-accent-soft p-12 text-body text-gray-800">
                  <Trans>
                    Across the same map, source, mode and build, your recent ADR changed by {adrChange} compared with
                    the previous window.
                  </Trans>
                </p>
              )}
              <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
                {[
                  { title: t`Previous matches`, period: trend.previous },
                  { title: t`Recent matches`, period: trend.recent },
                ].map(({ title, period }) => (
                  <div key={title} className="flex flex-col gap-12 rounded-8 bg-gray-75 p-16">
                    <h3 className="text-body-strong">
                      {title} · {period.matchCount}
                    </h3>
                    <p className="text-caption text-gray-700">
                      {formatDate(period.from)} – {formatDate(period.to)}
                    </p>
                    <dl className="grid grid-cols-2 gap-12 tabular-nums">
                      {[
                        { label: 'ADR', value: period.metrics.adr?.toFixed(1) },
                        { label: t`K/D`, value: period.metrics.kd?.toFixed(2) },
                        {
                          label: 'KAST',
                          value:
                            period.metrics.kastPercentage === null
                              ? null
                              : `${period.metrics.kastPercentage.toFixed(1)}%`,
                        },
                        {
                          label: t`Round win rate`,
                          value:
                            period.metrics.roundWinPercentage === null
                              ? null
                              : `${period.metrics.roundWinPercentage.toFixed(1)}%`,
                        },
                      ].map((item) => (
                        <div key={item.label}>
                          <dt className="text-caption text-gray-700">{item.label}</dt>
                          <dd className="text-heading">{item.value ?? '—'}</dd>
                        </div>
                      ))}
                    </dl>
                    <span className="text-caption text-gray-700">
                      {period.metrics.roundCount} <Trans>rounds</Trans>
                    </span>
                  </div>
                ))}
              </div>
              <span className="text-caption text-gray-700">
                {trend.comparable ? (
                  <Trans>Same map, source, mode and build</Trans>
                ) : (
                  <Trans>Mixed scenarios · use Practice and progress for matched comparisons</Trans>
                )}
              </span>
            </HabitsPanel>
          )}
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
            <Metric
              label={<Trans>Median match ADR</Trans>}
              value={stability.adrMedian?.toFixed(1) ?? '—'}
              sample={
                <>
                  {stability.matchCount} <Trans>matches</Trans>
                </>
              }
            />
            <Metric
              label={<Trans>Middle 50% of match ADR</Trans>}
              value={
                stability.adrP25 === null || stability.adrP75 === null
                  ? '—'
                  : `${stability.adrP25.toFixed(1)}–${stability.adrP75.toFixed(1)}`
              }
            />
            <Metric
              label={<Trans>Current match streak</Trans>}
              value={streaks.currentMatchCount}
              sample={
                streaks.currentMatchResult === 'win' ? t`Wins` : streaks.currentMatchResult === 'loss' ? t`Losses` : '—'
              }
            />
          </div>
          <AnalysisGroupTable title={<Trans>Monthly performance</Trans>} groups={analysis.byMonth} />
          <AnalysisGroupTable title={<Trans>Winning versus losing matches</Trans>} groups={analysis.byMatchResult} />
        </>
      )}
      {section === 'records' && (
        <>
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label={<Trans>Longest match win streak</Trans>} value={streaks.longestMatchWins} />
            <Metric label={<Trans>Longest round win streak</Trans>} value={streaks.longestRoundWins} />
            <Metric label={<Trans>Longest match loss streak</Trans>} value={streaks.longestMatchLosses} />
            <Metric label={<Trans>Longest round loss streak</Trans>} value={streaks.longestRoundLosses} />
          </div>
          <HabitsPanel title={<Trans>Memorable rounds</Trans>}>
            <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-3">
              {analysis.achievements.map((item) => (
                <article
                  key={item.code}
                  className="flex min-w-0 flex-col gap-12 rounded-8 border border-accent-muted bg-accent-soft p-16"
                >
                  <h3 className="text-body-strong">{achievementLabels[item.code]}</h3>
                  <p className="text-display text-accent tabular-nums">{item.count}</p>
                  <p className="text-caption text-gray-700 tabular-nums">
                    {item.count} / {item.total} <Trans>rounds</Trans>
                  </p>
                  <Evidence items={item.evidence} steamId={summary.steamId} />
                </article>
              ))}
            </div>
            {analysis.achievements.length === 0 && (
              <p className="text-gray-700">
                <Trans>No recorded milestone rounds in this selection yet.</Trans>
              </p>
            )}
          </HabitsPanel>
          {analysis.achievements.length > 0 && (
            <details className="rounded-8 border border-gray-300 p-16 text-caption text-gray-700">
              <summary className="cursor-pointer">
                <Trans>Record definitions</Trans>
              </summary>
              <dl className="mt-12 flex flex-col gap-12">
                {analysis.achievements.map((item) => (
                  <div key={item.code}>
                    <dt className="font-semibold">{achievementLabels[item.code]}</dt>
                    <dd>{achievementDefinitions[item.code]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function AnalysisGroupTable({ title, groups }: { title: ReactNode; groups: PersonalStatsGroup[] }) {
  const { t } = useLingui();
  const labels: Record<string, string> = {
    win: t`Won`,
    loss: t`Lost`,
    tie: t`Tied`,
    unknown: t`Unknown`,
    'first-half': t`First half`,
    'second-half': t`Second half`,
    overtime: t`Overtime`,
    unclassified: t`Unclassified`,
  };
  return (
    <HabitsPanel title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-caption whitespace-nowrap text-gray-700">
            <tr>
              {[t`Group`, t`Matches`, t`Rounds`, t`Round win rate`, t`K / D / A`, t`ADR`, t`KAST`].map((label) => (
                <th key={label} className="p-8">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ key, metrics, matchCount }) => (
              <tr key={key} className="border-t border-gray-300">
                <td className="p-8 whitespace-nowrap">{labels[key] ?? key}</td>
                <td className="p-8">{matchCount}</td>
                <td className="p-8">{metrics.roundCount}</td>
                <td className="p-8">
                  {metrics.roundWinPercentage === null ? '—' : `${metrics.roundWinPercentage.toFixed(1)}%`}
                </td>
                <td className="p-8 whitespace-nowrap">
                  {metrics.kills} / {metrics.deaths} / {metrics.assists}
                </td>
                <td className="p-8">{metrics.adr?.toFixed(1) ?? '—'}</td>
                <td className="p-8">
                  {metrics.kastPercentage === null ? '—' : `${metrics.kastPercentage.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HabitsPanel>
  );
}
