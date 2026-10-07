import React, { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { PersonalStatsGroup, PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { Select } from 'csdm/ui/components/inputs/select';
import { useChart } from 'csdm/ui/hooks/use-chart';
import { useChartColors } from 'csdm/ui/hooks/use-charts-colors';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { buildMatchPath } from 'csdm/ui/routes-paths';
import { HabitsPanel } from './habits-layout';
import { PersonalAnalysisPanels } from './personal-analysis-panels';

function number(value: number | null, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function percent(value: number | null) {
  return value === null ? '—' : `${number(value)}%`;
}

function PersonalMetric({ title, value, detail }: { title: ReactNode; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-8 border border-gray-300 bg-gray-50 p-16">
      <p className="text-caption text-gray-700">{title}</p>
      <p className="text-title tabular-nums">{value}</p>
      {detail && <p className="text-caption text-gray-700">{detail}</p>}
    </div>
  );
}

function MetricsGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-12 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

function StatsTable({ headers, rows }: { headers: ReactNode[]; rows: { key: string; cells: ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left tabular-nums">
        <thead className="text-caption whitespace-nowrap text-gray-700">
          <tr>
            {headers.map((header, index) => (
              <th className="p-8" key={index}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t border-gray-300" key={row.key}>
              {row.cells.map((cell, index) => (
                <td className="p-8 whitespace-nowrap" key={index}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-8 text-gray-700">
          <Trans>No data for this selection.</Trans>
        </p>
      )}
    </div>
  );
}

export function PersonalStatsPanels({ summary }: { summary: PersonalStatsSummary }) {
  const { t } = useLingui();
  const [tab, setTab] = useState('overview');
  const metrics = summary.metrics;
  const { matchWins, matchLosses, matchTies } = summary;
  const {
    headshotKills,
    kills,
    ratingRoundCount,
    rwsRoundCount,
    rwsMissingRoundCount,
    damage,
    openingAttempts,
    openingKillRoundWins,
    equipmentRoundCount,
    moneySpentRoundCount,
  } = metrics;
  const kd = number(metrics.kd, 2);
  const kda = number(metrics.kda, 2);
  const utilityPerRound = number(metrics.utilityDamagePerRound);
  const enemiesPerFlash = number(metrics.enemiesPerFlash, 2);
  const enemyBlindSeconds = number(metrics.enemyBlindSeconds);
  const skippedMatches = summary.coverage.skippedMatches;
  const tabs = [
    { value: 'overview', label: t`Overview` },
    { value: 'combat', label: t`Output and entry` },
    { value: 'utility', label: t`Teamplay and utility` },
    { value: 'clutch', label: t`Clutches and economy` },
    { value: 'matches', label: t`Trends` },
    { value: 'records', label: t`Personal records` },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-16">
      <div className="flex flex-wrap gap-8" role="group" aria-label={t`Personal analysis sections`}>
        {tabs.map((item) => (
          <Button
            key={item.value}
            variant={tab === item.value ? ButtonVariant.Primary : ButtonVariant.Default}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Headshot rate</Trans>}
              value={percent(metrics.headshotPercentage)}
              detail={t`${headshotKills} headshot kills / ${kills} enemy kills`}
            />
            <PersonalMetric
              title={<Trans>Rating 1.0 · historical formula</Trans>}
              value={number(metrics.hltvRating1, 2)}
              detail={t`${ratingRoundCount} eligible rounds`}
            />
            <PersonalMetric
              title={<Trans>RWS · local calculation</Trans>}
              value={number(metrics.rws, 2)}
              detail={t`${rwsRoundCount} valid rounds · ${rwsMissingRoundCount} unavailable`}
            />
            <PersonalMetric
              title={<Trans>ADR · damage per round</Trans>}
              value={number(metrics.adr)}
              detail={t`${damage} enemy health damage`}
            />
            <PersonalMetric
              title={<Trans>KAST</Trans>}
              value={percent(metrics.kastPercentage)}
              detail={`${metrics.kastRoundCount} / ${metrics.roundCount}`}
            />
            <PersonalMetric
              title={<Trans>Match win rate</Trans>}
              value={percent(summary.matchWinPercentage)}
              detail={t`${matchWins} wins · ${matchLosses} losses · ${matchTies} ties`}
            />
          </MetricsGrid>
          <PersonalAnalysisPanels summary={summary} section="overview" />
          <details className="rounded-12 border border-gray-300 bg-gray-100 p-16">
            <summary className="cursor-pointer font-semibold">
              <Trans>Map and side breakdown</Trans>
            </summary>
            <div className="mt-16 flex min-w-0 flex-col gap-16">
              <GroupTable title={<Trans>Performance by map</Trans>} groups={summary.byMap} matchResults={true} />
              <GroupTable title={<Trans>Performance by side</Trans>} groups={summary.bySide} />
            </div>
          </details>
        </>
      )}
      {tab === 'combat' && (
        <>
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Kills / deaths / assists</Trans>}
              value={`${kills} / ${metrics.deaths} / ${metrics.assists}`}
              detail={t`K/D ${kd} · (K+A)/D ${kda}`}
            />
            <PersonalMetric
              title={<Trans>Kills per round</Trans>}
              value={number(metrics.killsPerRound, 2)}
              detail={`${metrics.kills} / ${metrics.roundCount}`}
            />
            <PersonalMetric
              title={<Trans>Deaths per round</Trans>}
              value={number(metrics.deathsPerRound, 2)}
              detail={`${metrics.deaths} / ${metrics.roundCount}`}
            />
            <PersonalMetric
              title={<Trans>Opening kills / deaths</Trans>}
              value={`${metrics.openingKills} / ${metrics.openingDeaths}`}
              detail={`${metrics.openingAttempts} / ${metrics.roundCount}`}
            />
            <PersonalMetric
              title={<Trans>Opening duel success</Trans>}
              value={percent(metrics.openingSuccessPercentage)}
              detail={t`${openingAttempts} opening duels`}
            />
            <PersonalMetric
              title={<Trans>Opening participation</Trans>}
              value={percent(metrics.openingAttemptPercentage)}
              detail={`${metrics.openingAttempts} / ${metrics.roundCount}`}
            />
            <PersonalMetric
              title={<Trans>Win rate after an opening kill</Trans>}
              value={percent(metrics.openingConversionPercentage)}
              detail={t`${openingKillRoundWins} rounds won after your opening kill`}
            />
            <PersonalMetric
              title={<Trans>Trade kills</Trans>}
              value={metrics.tradeKills}
              detail={t`Within five seconds`}
            />
            <PersonalMetric
              title={<Trans>Deaths traded by teammates</Trans>}
              value={metrics.tradedDeaths}
              detail={percent(metrics.tradedDeathPercentage)}
            />
            <PersonalMetric
              title={<Trans>Multi-kill rounds</Trans>}
              value={metrics.multiKills.slice(2).reduce((sum, count) => sum + count, 0)}
              detail={percent(
                metrics.roundCount
                  ? (metrics.multiKills.slice(2).reduce((sum, count) => sum + count, 0) * 100) / metrics.roundCount
                  : null,
              )}
            />
          </MetricsGrid>
          <PersonalAnalysisPanels summary={summary} section="combat" />
          <HabitsPanel title={<Trans>Kills per round distribution</Trans>}>
            <div className="grid grid-cols-3 gap-12 xl:grid-cols-6">
              {metrics.multiKills.map((count, kills) => (
                <PersonalMetric
                  key={kills}
                  title={kills === 5 ? t`5+ kills` : t`${kills} kills`}
                  value={count}
                  detail={percent(metrics.roundCount ? (count * 100) / metrics.roundCount : null)}
                />
              ))}
            </div>
          </HabitsPanel>
          <WeaponsTable summary={summary} />
        </>
      )}
      {tab === 'utility' && (
        <>
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Utility damage</Trans>}
              value={metrics.utilityDamage}
              detail={t`${utilityPerRound} per round`}
            />
            <PersonalMetric
              title={<Trans>Enemies flashed (&gt;1 s)</Trans>}
              value={metrics.enemiesFlashed}
              detail={t`${enemiesPerFlash} per flash thrown`}
            />
            <PersonalMetric
              title={<Trans>Enemy blind time</Trans>}
              value={t`${enemyBlindSeconds} s`}
              detail={<Trans>Total recorded enemy flash duration</Trans>}
            />
            <PersonalMetric title={<Trans>Flash assists</Trans>} value={metrics.flashAssists} />
            <PersonalMetric title={<Trans>Teammates flashed (&gt;1 s)</Trans>} value={metrics.teammatesFlashed} />
            <PersonalMetric title={<Trans>Friendly fire damage</Trans>} value={metrics.friendlyDamage} />
            <PersonalMetric title={<Trans>Bomb plants</Trans>} value={metrics.bombPlants} />
            <PersonalMetric title={<Trans>Bomb defuses</Trans>} value={metrics.bombDefuses} />
          </MetricsGrid>
          <PersonalAnalysisPanels summary={summary} section="utility" />
          <HabitsPanel title={<Trans>Grenades used</Trans>}>
            <StatsTable
              headers={[t`Grenade`, t`Thrown`, t`Per round`]}
              rows={[
                { key: 'flash', label: t`Flashbang`, count: metrics.flashesThrown },
                { key: 'smoke', label: t`Smoke`, count: metrics.smokesThrown },
                { key: 'he', label: t`HE grenade`, count: metrics.heThrown },
                { key: 'fire', label: t`Molotov / incendiary`, count: metrics.fireThrown },
                { key: 'decoy', label: t`Decoy`, count: metrics.decoysThrown },
              ].map((item) => ({
                key: item.key,
                cells: [item.label, item.count, number(metrics.roundCount ? item.count / metrics.roundCount : null, 2)],
              }))}
            />
          </HabitsPanel>
        </>
      )}
      {tab === 'clutch' && (
        <>
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Clutches won / attempted</Trans>}
              value={`${metrics.clutchWins} / ${metrics.clutchAttempts}`}
              detail={percent(metrics.clutchWinPercentage)}
            />
            <PersonalMetric
              title={<Trans>Survival rate</Trans>}
              value={percent(metrics.survivalPercentage)}
              detail={`${metrics.survivedRoundCount} / ${metrics.roundCount}`}
            />
          </MetricsGrid>
          <HabitsPanel title={<Trans>Clutches by difficulty</Trans>}>
            <StatsTable
              headers={[t`Situation`, t`Attempts`, t`Wins`, t`Win rate`]}
              rows={summary.byClutchSize.map((group) => ({
                key: String(group.opponents),
                cells: [`1v${group.opponents}`, group.attempts, group.wins, percent(group.winPercentage)],
              }))}
            />
          </HabitsPanel>
          <PersonalAnalysisPanels summary={summary} section="clutch" />
          <GroupTable title={<Trans>Performance by economy</Trans>} groups={summary.byEconomy} economy={true} />
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Average equipment value</Trans>}
              value={number(metrics.averageEquipmentValue, 0)}
              detail={t`${equipmentRoundCount} rounds with equipment data`}
            />
            <PersonalMetric
              title={<Trans>Average money spent</Trans>}
              value={number(metrics.averageMoneySpent, 0)}
              detail={t`${moneySpentRoundCount} rounds with spending data`}
            />
          </MetricsGrid>
        </>
      )}
      {tab === 'matches' && (
        <>
          <PersonalAnalysisPanels summary={summary} section="matches" />
          <PerformanceTrend summary={summary} />
          <MatchHistory summary={summary} />
        </>
      )}
      {tab === 'records' && <PersonalAnalysisPanels summary={summary} section="records" />}
      <details className="rounded-12 border border-gray-300 bg-gray-100 p-16 text-caption text-gray-700">
        <summary className="cursor-pointer font-semibold">
          <Trans>Calculation details</Trans>
        </summary>
        <div className="mt-12 flex flex-col gap-12">
          <p>
            <Trans>
              Core totals include every match in the current filters. The 5v5 sections exclude nonstandard matches.
              Rates use summed counts; a dash means the denominator or required data is missing.
            </Trans>
          </p>
          <p>
            <Trans>
              Headshot rate divides headshot kills by enemy kills. KAST counts rounds with a kill, assist, survival or
              traded death. Trades use five seconds. Opening events use the first enemy elimination of a round.
            </Trans>
          </p>
          <p>
            <Trans>
              Rating is the historical public HLTV 1.0 formula. RWS uses the public FACEIT 2025 damage and
              bomb-objective rules: 100 damage points in a won round, or 70 damage points plus 30 objective points.
              Undefined rounds are excluded.
            </Trans>
          </p>
          <p>
            <Trans>
              Utility efficiency divides enemy HE and fire damage by grenades thrown. Flash counts require more than one
              second of recorded blindness. Economy uses equipment at round start.
            </Trans>
          </p>
          <p>
            <Trans>
              Half labels require a verified 12- or 15-round side change; other rounds remain unclassified. Monthly
              groups use UTC. Recent windows show equal-sized groups of up to five matches. Round streaks stay within
              each match.
            </Trans>
          </p>
          <p>
            <Trans>
              Match streaks follow the selected local matches. Ties, unknown results and nonstandard matches break the
              streak. Match win rates exclude unknown results.
            </Trans>
          </p>
        </div>
      </details>
      {summary.coverage.skippedMatches > 0 && (
        <p className="text-caption text-orange-500">
          <Trans>{skippedMatches} matches lack complete personal statistics and are excluded from these metrics.</Trans>
        </p>
      )}
    </div>
  );
}

function GroupTable({
  title,
  groups,
  economy = false,
  matchResults = false,
}: {
  title: ReactNode;
  groups: PersonalStatsGroup[];
  economy?: boolean;
  matchResults?: boolean;
}) {
  const { t } = useLingui();
  const economyLabels: Record<string, string> = {
    pistol: t`Pistol round`,
    eco: t`Eco`,
    semi: t`Semi-buy`,
    'force-buy': t`Force-buy`,
    full: t`Full buy`,
    unknown: t`Unknown`,
  };
  return (
    <HabitsPanel title={title}>
      <StatsTable
        headers={[
          t`Group`,
          t`Matches`,
          ...(matchResults ? [t`Match win rate`] : []),
          t`Rounds`,
          t`Round win rate`,
          t`K / D / A`,
          t`ADR`,
          t`HS%`,
          t`KAST`,
          t`Rating 1.0`,
          t`RWS`,
        ]}
        rows={groups.map(({ key, metrics, matchCount, matchWinPercentage, matchWins, knownResultMatchCount }) => ({
          key,
          cells: [
            economy ? (economyLabels[key] ?? key) : key === 't' ? 'T' : key === 'ct' ? 'CT' : key,
            matchCount,
            ...(matchResults
              ? [
                  <span key="win-rate" className="flex flex-col gap-4">
                    {percent(matchWinPercentage)}
                    <span className="text-caption text-gray-700">
                      {matchWins} / {knownResultMatchCount}
                    </span>
                  </span>,
                ]
              : []),
            metrics.roundCount,
            percent(metrics.roundWinPercentage),
            `${metrics.kills} / ${metrics.deaths} / ${metrics.assists}`,
            number(metrics.adr),
            percent(metrics.headshotPercentage),
            percent(metrics.kastPercentage),
            number(metrics.hltvRating1, 2),
            number(metrics.rws, 2),
          ],
        }))}
      />
    </HabitsPanel>
  );
}

function WeaponsTable({ summary }: { summary: PersonalStatsSummary }) {
  const { t } = useLingui();
  return (
    <HabitsPanel title={<Trans>Weapon performance</Trans>}>
      <StatsTable
        headers={[t`Weapon`, t`Kills`, t`HS%`, t`Damage`, t`Shots fired`]}
        rows={summary.weapons.map((weapon) => ({
          key: weapon.weapon,
          cells: [
            weapon.weapon,
            weapon.kills,
            percent(weapon.kills ? (weapon.headshotKills * 100) / weapon.kills : null),
            weapon.damage,
            weapon.shots,
          ],
        }))}
      />
    </HabitsPanel>
  );
}

function PerformanceTrend({ summary }: { summary: PersonalStatsSummary }) {
  const { t } = useLingui();
  const colors = useChartColors();
  const formatDate = useFormatDate();
  const [metric, setMetric] = useState<'adr' | 'hltvRating1' | 'rws' | 'headshotPercentage' | 'kastPercentage' | 'kd'>(
    'adr',
  );
  const options = [
    { value: 'adr', label: t`ADR` },
    { value: 'hltvRating1', label: t`Rating 1.0` },
    { value: 'rws', label: t`RWS` },
    { value: 'headshotPercentage', label: t`HS%` },
    { value: 'kastPercentage', label: t`KAST` },
    { value: 'kd', label: t`K/D` },
  ] as const;
  const matches = summary.matches.toSorted((a, b) => a.date.localeCompare(b.date)).slice(-50);
  const label = options.find((option) => option.value === metric)?.label;
  const { ref } = useChart({
    option: {
      color: [colors.teamB],
      grid: { left: 48, right: 16, top: 24, bottom: 48 },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        backgroundColor: colors.tooltipBackgroundColor,
        borderColor: colors.tooltipBorderColor,
        textStyle: { color: colors.tooltipTextColor },
      },
      xAxis: {
        type: 'category',
        data: matches.map(
          (match, index) =>
            `${index + 1} · ${formatDate(match.date, { year: 'numeric', month: '2-digit', day: '2-digit' })} · ${match.mapName}`,
        ),
        axisLabel: { color: colors.labelTextColor, hideOverlap: true },
        axisLine: { lineStyle: { color: colors.splitLineColor } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: colors.labelTextColor },
        splitLine: { lineStyle: { color: colors.splitLineColor } },
      },
      series: [
        {
          name: label,
          type: 'line',
          connectNulls: false,
          data: matches.map((match) => {
            const value = match.metrics[metric];
            return value === null ? null : Number(value.toFixed(2));
          }),
        },
      ],
    },
  });
  return (
    <HabitsPanel title={<Trans>Recent performance trend</Trans>}>
      <Select label={<Trans>Metric</Trans>} value={metric} onChange={setMetric} options={[...options]} />
      <div className="aspect-video w-full" ref={ref} role="img" aria-label={t`Recent match trend: ${label}`} />
      <p className="text-caption text-gray-700">
        <Trans>Latest 50 matches · one point per match · oldest to newest</Trans>
      </p>
    </HabitsPanel>
  );
}

function MatchHistory({ summary }: { summary: PersonalStatsSummary }) {
  const { t } = useLingui();
  const formatDate = useFormatDate();
  const [limit, setLimit] = useState(20);
  const resultLabels = { win: t`Win`, loss: t`Loss`, tie: t`Tie`, unknown: t`Unknown` };
  const matches = summary.matches.toSorted((a, b) => b.date.localeCompare(a.date));
  return (
    <HabitsPanel title={<Trans>Personal match history</Trans>}>
      <StatsTable
        headers={[t`Match`, t`Result`, t`Rounds`, t`K / D / A`, t`ADR`, t`HS%`, t`KAST`, t`Rating 1.0`, t`RWS`]}
        rows={matches.slice(0, limit).map((match) => ({
          key: match.checksum,
          cells: [
            <Link key={match.checksum} className="text-blue-500" to={buildMatchPath(match.checksum)}>
              {match.mapName}
              <span className="block text-caption text-gray-700">{formatDate(match.date)}</span>
            </Link>,
            resultLabels[match.result],
            match.metrics.roundCount,
            `${match.metrics.kills} / ${match.metrics.deaths} / ${match.metrics.assists}`,
            number(match.metrics.adr),
            percent(match.metrics.headshotPercentage),
            percent(match.metrics.kastPercentage),
            number(match.metrics.hltvRating1, 2),
            number(match.metrics.rws, 2),
          ],
        }))}
      />
      {matches.length > limit && (
        <Button onClick={() => setLimit((value) => value + 20)}>
          <Trans>Show more matches</Trans>
        </Button>
      )}
    </HabitsPanel>
  );
}
