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
  return <div className="grid grid-cols-2 gap-12 xl:grid-cols-4">{children}</div>;
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
    survivedRoundCount,
    openingAttempts,
    openingKillRoundWins,
    economyRoundCount,
  } = metrics;
  const kd = number(metrics.kd, 2);
  const kda = number(metrics.kda, 2);
  const roundWinRate = percent(metrics.roundWinPercentage);
  const utilityPerRound = number(metrics.utilityDamagePerRound);
  const enemiesPerFlash = number(metrics.enemiesPerFlash, 2);
  const enemyBlindSeconds = number(metrics.enemyBlindSeconds);
  const skippedMatches = summary.coverage.skippedMatches;
  const tabs = [
    { value: 'overview', label: t`Personal overview` },
    { value: 'combat', label: t`Duels and clutches` },
    { value: 'utility', label: t`Utility and objectives` },
    { value: 'breakdowns', label: t`Maps, sides and economy` },
    { value: 'matches', label: t`Match history and trends` },
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
              title={<Trans>Matches / rounds</Trans>}
              value={`${summary.matchCount} / ${metrics.roundCount}`}
              detail={t`${matchWins} wins · ${matchLosses} losses · ${matchTies} ties`}
            />
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
              title={<Trans>Kills / deaths / assists</Trans>}
              value={`${kills} / ${metrics.deaths} / ${metrics.assists}`}
              detail={t`K/D ${kd} · (K+A)/D ${kda}`}
            />
            <PersonalMetric
              title={<Trans>ADR · damage per round</Trans>}
              value={number(metrics.adr)}
              detail={t`${damage} enemy health damage`}
            />
            <PersonalMetric
              title={<Trans>KAST</Trans>}
              value={percent(metrics.kastPercentage)}
              detail={<Trans>Rounds with a kill, assist, survival or traded death</Trans>}
            />
            <PersonalMetric
              title={<Trans>Match win rate</Trans>}
              value={percent(summary.matchWinPercentage)}
              detail={t`Round win rate ${roundWinRate}`}
            />
            <PersonalMetric title={<Trans>Kills per round</Trans>} value={number(metrics.killsPerRound, 2)} />
            <PersonalMetric title={<Trans>Deaths per round</Trans>} value={number(metrics.deathsPerRound, 2)} />
            <PersonalMetric
              title={<Trans>Survival rate</Trans>}
              value={percent(metrics.survivalPercentage)}
              detail={t`${survivedRoundCount} rounds survived`}
            />
            <PersonalMetric title={<Trans>Flash assists</Trans>} value={metrics.flashAssists} />
          </MetricsGrid>
          <HabitsPanel title={<Trans>How to read these numbers</Trans>}>
            <p className="text-gray-700">
              <Trans>
                Rates use total events and rounds across the selected demos. A dash means unavailable, not zero. Map and
                side filters apply to every panel.
              </Trans>
            </p>
            <p className="text-caption text-gray-700">
              <Trans>
                Rating uses the public historical HLTV 1.0 formula. RWS uses the published FACEIT 2025 damage and
                bomb-objective rules, calculated locally. Neither is a platform-certified score or HLTV 2.x / 3.0.
              </Trans>
            </p>
            <p className="text-caption text-gray-700">
              <Trans>
                Some community servers label 5v5 matches as casual. Rating eligibility also checks observed teams and
                round structure; the original demo mode is preserved.
              </Trans>
            </p>
            <p className="text-caption text-gray-700">
              <Trans>
                RWS only rewards won rounds: 100 points by damage, or 70 by damage plus 30 for the winning plant/defuse.
                Undefined rounds are excluded and reported above. Trades use a five-second window.
              </Trans>
            </p>
            <p className="text-caption text-gray-700">
              <Trans>
                These demos describe your own sample. Aim scores, rank percentiles and visibility-based reaction time
                need additional models and are not inferred here.
              </Trans>
            </p>
          </HabitsPanel>
        </>
      )}
      {tab === 'combat' && (
        <>
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Opening kills / deaths</Trans>}
              value={`${metrics.openingKills} / ${metrics.openingDeaths}`}
              detail={<Trans>First enemy elimination of each round</Trans>}
            />
            <PersonalMetric
              title={<Trans>Opening duel success</Trans>}
              value={percent(metrics.openingSuccessPercentage)}
              detail={t`${openingAttempts} opening duels`}
            />
            <PersonalMetric
              title={<Trans>Opening participation</Trans>}
              value={percent(metrics.openingAttemptPercentage)}
              detail={<Trans>Rounds where you took the first duel</Trans>}
            />
            <PersonalMetric
              title={<Trans>Win rate after an opening kill</Trans>}
              value={percent(metrics.openingConversionPercentage)}
              detail={t`${openingKillRoundWins} rounds won after your opening kill`}
            />
            <PersonalMetric
              title={<Trans>Trade kills</Trans>}
              value={metrics.tradeKills}
              detail={<Trans>Enemy killed within five seconds of killing a teammate</Trans>}
            />
            <PersonalMetric
              title={<Trans>Deaths traded by teammates</Trans>}
              value={metrics.tradedDeaths}
              detail={percent(metrics.tradedDeathPercentage)}
            />
            <PersonalMetric
              title={<Trans>Clutches won / attempted</Trans>}
              value={`${metrics.clutchWins} / ${metrics.clutchAttempts}`}
              detail={percent(metrics.clutchWinPercentage)}
            />
            <PersonalMetric
              title={<Trans>Multi-kill rounds</Trans>}
              value={metrics.multiKills.slice(2).reduce((sum, count) => sum + count, 0)}
              detail={<Trans>Rounds with at least two enemy kills</Trans>}
            />
          </MetricsGrid>
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
          <HabitsPanel title={<Trans>Clutches by difficulty</Trans>}>
            <StatsTable
              headers={[t`Situation`, t`Attempts`, t`Wins`, t`Win rate`]}
              rows={summary.byClutchSize.map((group) => ({
                key: String(group.opponents),
                cells: [`1v${group.opponents}`, group.attempts, group.wins, percent(group.winPercentage)],
              }))}
            />
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
      {tab === 'breakdowns' && (
        <>
          <GroupTable title={<Trans>Performance by map</Trans>} groups={summary.byMap} matchResults={true} />
          <GroupTable title={<Trans>Performance by side</Trans>} groups={summary.bySide} />
          <GroupTable title={<Trans>Performance by economy</Trans>} groups={summary.byEconomy} economy={true} />
          <MetricsGrid>
            <PersonalMetric
              title={<Trans>Average equipment value</Trans>}
              value={number(metrics.averageEquipmentValue, 0)}
              detail={t`${economyRoundCount} rounds with economy data`}
            />
            <PersonalMetric title={<Trans>Average money spent</Trans>} value={number(metrics.averageMoneySpent, 0)} />
          </MetricsGrid>
          <p className="text-caption text-gray-700">
            <Trans>
              Economy groups use the parser's round-start equipment classification. Results from different maps, game
              modes, builds and sources are descriptive and may not be directly comparable.
            </Trans>
          </p>
        </>
      )}
      {tab === 'matches' && (
        <>
          <PerformanceTrend summary={summary} />
          <MatchHistory summary={summary} />
        </>
      )}
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
        rows={groups.map(({ key, metrics, matchCount, matchWinPercentage }) => ({
          key,
          cells: [
            economy ? (economyLabels[key] ?? key) : key === 't' ? 'T' : key === 'ct' ? 'CT' : key,
            matchCount,
            ...(matchResults ? [percent(matchWinPercentage)] : []),
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
      <p className="text-caption text-gray-700">
        <Trans>
          Shots include suppressive fire and penetration attempts. Shot accuracy is not inferred from damage-event
          counts.
        </Trans>
      </p>
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
        <Trans>
          Up to 50 recent matches, oldest to newest. Each point is one match; missing values stay empty. Exact values
          and match links are listed below.
        </Trans>
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
