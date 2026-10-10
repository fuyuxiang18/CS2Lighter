import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import type { TacticalScenario, TacticalScenarioCode } from 'csdm/common/types/tactical-analysis';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { HabitsPanel } from './habits-layout';

type TacticalTheme = 'advantage' | 'trading' | 'utility' | 'objective';

const themeScenarios: Record<TacticalTheme, TacticalScenarioCode[]> = {
  advantage: ['opening-kill-survived', 'opening-kill-died', 'opening-kill-quick-death'],
  trading: ['opening-death-traded', 'opening-death-untraded', 'trade-kill-round'],
  utility: [
    'flash-assist-round',
    'flash-without-long-enemy-blind',
    'teammate-flash-round',
    'damage-utility-hit',
    'damage-utility-no-damage',
  ],
  objective: [
    'personal-plant-won',
    'personal-plant-lost',
    'clutch-1v1',
    'clutch-1v2plus',
    'low-equipment-damage',
    'low-equipment-no-damage',
  ],
};

function percent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export function TacticalAnalysisPanels({ summary }: { summary: PersonalStatsSummary }) {
  const { t } = useLingui();
  const [theme, setTheme] = useState<TacticalTheme>('advantage');
  const { analysis } = summary;
  const themes: { id: TacticalTheme; title: string; question: string; practice: string }[] = [
    {
      id: 'advantage',
      title: t`Convert the advantage`,
      question: t`After the first kill, what made the next fight worth taking?`,
      practice: t`Review three lost opening-kill rounds. Before the next engagement, name the objective: take space, protect the bomb, delay, or disengage.`,
    },
    {
      id: 'trading',
      title: t`Trade together`,
      question: t`When the first player met an enemy, could the second player see that same target?`,
      practice: t`Rehearse one common entry with a teammate. Stop at first contact and check both sightlines, then repeat with a spacing that lets the second player trade.`,
    },
    {
      id: 'utility',
      title: t`Coordinate utility`,
      question: t`Did the grenade create a fight your team was ready to take?`,
      practice: t`Choose one common entrance and agree on a go signal. Get the entry player in position before the flash pops; check both views afterward.`,
    },
    {
      id: 'objective',
      title: t`Economy and objectives`,
      question: t`Did your equipment and the round clock support the objective you chose?`,
      practice: t`Compare three wins and three losses with similar equipment. Check the first contact, grenade allocation, and what you did after planting or entering a clutch.`,
    },
  ];
  const selectedTheme = themes.find((item) => item.id === theme) ?? themes[0];
  const scenarios = themeScenarios[theme].flatMap((code) => {
    const scenario = analysis.tactics.scenarios.find((item) => item.code === code);
    return scenario ? [scenario] : [];
  });

  if (analysis.scope.roundCount === 0) {
    return (
      <p className="rounded-8 bg-gray-100 p-16 text-gray-700">
        <Trans>No standard 5v5 rounds in this selection.</Trans>
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-16">
      <HabitsPanel title={<Trans>Decisions behind your results</Trans>}>
        <div className="flex flex-wrap items-center gap-8 text-body text-gray-800">
          {[
            t`Allocate resources`,
            t`Contest space`,
            t`Create a favorable fight`,
            t`Coordinate the exchange`,
            t`Secure the round`,
          ].map((step, index) => (
            <React.Fragment key={step}>
              {index > 0 && <span aria-hidden="true">→</span>}
              <span className="rounded-4 bg-gray-75 px-8 py-4">{step}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-8 xl:grid-cols-4" role="group" aria-label={t`Tactical themes`}>
          {themes.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={theme === item.id}
              onClick={() => setTheme(item.id)}
              className={`flex min-w-0 items-center gap-8 rounded-8 border p-12 text-left text-body-strong transition-colors ${
                theme === item.id
                  ? 'border-accent-muted bg-accent-soft text-accent'
                  : 'border-gray-300 text-gray-800 hover:bg-gray-75'
              }`}
            >
              <span className="text-caption tabular-nums">0{index + 1}</span>
              {item.title}
            </button>
          ))}
        </div>
      </HabitsPanel>

      <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
        <header className="flex flex-wrap items-start justify-between gap-12">
          <div className="flex min-w-0 flex-col gap-8">
            <h2 className="text-subtitle font-semibold">{selectedTheme.title}</h2>
            <p className="text-body text-gray-800">{selectedTheme.question}</p>
          </div>
          <span className="rounded-4 bg-gray-75 px-8 py-4 text-caption text-gray-700 tabular-nums">
            {analysis.scope.matchCount} <Trans>matches</Trans> · {analysis.scope.roundCount} <Trans>rounds</Trans>
          </span>
        </header>
        <div key={theme} className="flex min-w-0 flex-col gap-8">
          {scenarios.map((scenario, index) => (
            <ScenarioRow
              key={scenario.code}
              scenario={scenario}
              steamId={summary.steamId}
              initiallyOpen={index === 0}
            />
          ))}
        </div>
        <div className="flex flex-col gap-8 rounded-8 border border-accent-muted bg-accent-soft p-16">
          <h3 className="text-body-strong text-accent">
            <Trans>Practice one decision next match</Trans>
          </h3>
          <p className="text-body text-gray-800">{selectedTheme.practice}</p>
        </div>
      </section>

      <details className="rounded-12 border border-gray-300 bg-gray-100 p-16">
        <summary className="cursor-pointer text-body-strong">
          <Trans>Four questions for your view and the opponent's view</Trans>
        </summary>
        <ol className="mt-16 grid list-inside list-decimal grid-cols-1 gap-16 text-body text-gray-800 lg:grid-cols-2">
          <li>
            <Trans>Who was closer to the shared cover, and who could see the other player first?</Trans>
          </li>
          <li>
            <Trans>How many angles did your peek expose you to? Could a teammate see the same enemy?</Trans>
          </li>
          <li>
            <Trans>After the smoke blocked one sightline, could your teammate still support your fight?</Trans>
          </li>
          <li>
            <Trans>
              After shooting or throwing, what did the opponent know? Could you reposition before fighting again?
            </Trans>
          </li>
        </ol>
      </details>
    </div>
  );
}

function ScenarioRow({
  scenario,
  steamId,
  initiallyOpen,
}: {
  scenario: TacticalScenario;
  steamId: string;
  initiallyOpen: boolean;
}) {
  const { t } = useLingui();
  const { count, total, percentage } = scenario.frequency;
  const { wins } = scenario;
  const copy: Record<
    TacticalScenarioCode,
    { label: string; denominator: string; observation: string; review: string; fixedOutcome?: boolean }
  > = {
    'opening-kill-survived': {
      label: t`Opening kill, then survived`,
      denominator: t`your opening-kill rounds`,
      observation: t`You survived to the end in ${count} of ${total} opening-kill rounds; your team won ${wins} of these.`,
      review: t`Find the cover, repositioning, or teammate contact that let you keep contributing after the kill. Repeat that decision when the same position comes up.`,
    },
    'opening-kill-died': {
      label: t`Opening kill, then died`,
      denominator: t`your opening-kill rounds`,
      observation: t`You died later in ${count} of ${total} opening-kill rounds; your team still won ${wins} of these.`,
      review: t`Pause before your next fight. Check what the fight could gain and whether a teammate could trade you. Keep useful exchanges; replace unnecessary re-peeks with a new position.`,
    },
    'opening-kill-quick-death': {
      label: t`Died within 10 seconds of an opening kill`,
      denominator: t`timed opening-kill rounds`,
      observation: t`You died within ten seconds of your opening kill in ${count} of ${total} timed opening-kill rounds.`,
      review: t`Watch from the first kill to your death in both views. Check whether the opponent already knew your position and whether you had time to leave the exposed angle.`,
    },
    'opening-death-traded': {
      label: t`Opening death traded within 5 seconds`,
      denominator: t`your opening-death rounds`,
      observation: t`A teammate traded your opening death within five seconds in ${count} of ${total} rounds; your team won ${wins} of these.`,
      review: t`Check where the second player stood at first contact. Save the spacing and shared target that made the trade possible, then rehearse the entry together.`,
    },
    'opening-death-untraded': {
      label: t`Opening death without a 5-second trade`,
      denominator: t`your opening-death rounds`,
      observation: t`Your opening death had no trade within five seconds in ${count} of ${total} rounds; your team won ${wins} of these.`,
      review: t`Compare the teammate's angle with yours at first contact. Check the distance, smoke, and timing before deciding whether to wait, change the route, or bring support closer.`,
    },
    'trade-kill-round': {
      label: t`Rounds with a trade kill`,
      denominator: t`selected 5v5 rounds`,
      observation: t`You made at least one trade kill in ${count} of ${total} rounds; your team won ${wins} of these.`,
      review: t`Check when you learned where the enemy was and how quickly you could reach the same target. Rehearse following the first player without blocking the retreat.`,
    },
    'flash-assist-round': {
      label: t`Rounds with a flash assist`,
      denominator: t`selected 5v5 rounds`,
      observation: t`You recorded a flash assist in ${count} of ${total} rounds; your team won ${wins} of these.`,
      review: t`Compare the flash pop with your teammate's first exposure. Keep the throw and go signal that connected the blind with the fight.`,
    },
    'flash-without-long-enemy-blind': {
      label: t`Flash rounds without an enemy blinded for over 1 second`,
      denominator: t`rounds where you threw a flash`,
      observation: t`No enemy blindness longer than one second was recorded in ${count} of ${total} rounds where you threw a flash.`,
      review: t`Watch whether the enemy turned, fell back, or was absent. If a fight was intended, check the pop location and teammate timing before changing the lineup.`,
    },
    'teammate-flash-round': {
      label: t`Flash rounds with a teammate blinded for over 1 second`,
      denominator: t`rounds where you threw a flash`,
      observation: t`A teammate was blinded for more than one second in ${count} of ${total} rounds where you threw a flash.`,
      review: t`Replay from the affected teammate's view. Check the call, turn-away time, and pop position; agree on a clear warning before repeating the throw.`,
    },
    'damage-utility-hit': {
      label: t`HE or fire rounds with enemy utility damage`,
      denominator: t`rounds where you threw HE or fire`,
      observation: t`You dealt enemy utility damage in ${count} of ${total} rounds where you threw an HE or fire grenade.`,
      review: t`Check what happened after the damage: a teammate's push, a forced reposition, or a delayed attack. Reuse the throw with the follow-up that served your round plan.`,
    },
    'damage-utility-no-damage': {
      label: t`HE or fire rounds without enemy utility damage`,
      denominator: t`rounds where you threw HE or fire`,
      observation: t`No enemy utility damage was recorded in ${count} of ${total} rounds where you threw an HE or fire grenade.`,
      review: t`Check whether the grenade delayed a push, cleared a hiding place, or covered a retreat. When damage was the goal, compare the throw timing with the enemy's arrival.`,
    },
    'personal-plant-won': {
      label: t`Won after your own bomb plant`,
      denominator: t`your T-side plant rounds`,
      observation: t`Your team won ${count} of ${total} T-side rounds in which you planted the bomb.`,
      review: t`Check the plant position, post-plant sightlines, and remaining time. Keep a setup where a teammate can trade and the bomb forces the opponent to act.`,
      fixedOutcome: true,
    },
    'personal-plant-lost': {
      label: t`Lost after your own bomb plant`,
      denominator: t`your T-side plant rounds`,
      observation: t`Your team lost ${count} of ${total} T-side rounds in which you planted the bomb.`,
      review: t`Pause after the plant. Check whether you could protect the bomb from cover, share a target with a teammate, or let the clock work before taking another fight.`,
      fixedOutcome: true,
    },
    'clutch-1v1': {
      label: t`1v1 clutch attempts`,
      denominator: t`your clutch rounds`,
      observation: t`You entered a 1v1 in ${count} of ${total} recorded clutch rounds, winning ${wins} of these 1v1s.`,
      review: t`Replay the start of the clutch. List the bomb state, time left, and last known enemy position, then check which of those facts drove your move.`,
    },
    'clutch-1v2plus': {
      label: t`1v2+ clutch attempts`,
      denominator: t`your clutch rounds`,
      observation: t`You faced two or more opponents in ${count} of ${total} recorded clutch rounds, winning ${wins} of these attempts.`,
      review: t`Look for the first isolated fight and what separated it from the next. Rehearse the route or utility that stopped multiple opponents from fighting you together.`,
    },
    'low-equipment-damage': {
      label: t`Equipment at $2000 or less, with damage`,
      denominator: t`rounds with personal equipment worth $0–2000`,
      observation: t`You dealt enemy damage in ${count} of ${total} rounds with personal starting equipment worth $2000 or less.`,
      review: t`Check which distance, shared angle, or recovered weapon made your equipment useful. Pick a route that suits the weapon before leaving spawn.`,
    },
    'low-equipment-no-damage': {
      label: t`Equipment at $2000 or less, without damage`,
      denominator: t`rounds with personal equipment worth $0–2000`,
      observation: t`You dealt no enemy damage in ${count} of ${total} rounds with personal starting equipment worth $2000 or less.`,
      review: t`Check whether the round plan was to save, stack, or contest a weapon. If you sought a fight, compare its distance and timing with your equipment and teammate support.`,
    },
  };
  const selected = copy[scenario.code];

  return (
    <details open={initiallyOpen} className="group min-w-0 rounded-8 border border-gray-300">
      <summary className="cursor-pointer p-12 text-body-strong marker:text-accent hover:bg-gray-75">
        <span className="ml-4 inline-flex max-w-full flex-wrap items-center gap-x-16 gap-y-4 align-middle">
          <span className="min-w-0 wrap-break-word">{selected.label}</span>
          <span className="text-heading text-accent tabular-nums">{percent(percentage)}</span>
          <span className="text-caption font-normal text-gray-700 tabular-nums">
            {count} / {total} · {selected.denominator}
          </span>
        </span>
      </summary>
      <div className="flex min-w-0 flex-col gap-16 border-t border-gray-300 p-16">
        {total === 0 ? (
          <p className="text-body text-gray-700">
            <Trans>No eligible rounds for this scenario in the current selection.</Trans>
          </p>
        ) : (
          <p className="text-body text-gray-800">{selected.observation}</p>
        )}
        {count > 0 && (
          <dl className="grid grid-cols-2 gap-12">
            {!selected.fixedOutcome && (
              <div className="rounded-8 bg-gray-75 p-12">
                <dt className="text-caption text-gray-700">
                  <Trans>Round win rate in this scenario</Trans>
                </dt>
                <dd className="mt-4 text-heading tabular-nums">
                  {percent(scenario.winPercentage)}
                  <span className="ml-8 text-caption text-gray-700">
                    {wins} / {count}
                  </span>
                </dd>
              </div>
            )}
            <div className="rounded-8 bg-gray-75 p-12">
              <dt className="text-caption text-gray-700">
                <Trans>ADR in matching rounds</Trans>
              </dt>
              <dd className="mt-4 text-heading tabular-nums">{scenario.adr?.toFixed(1) ?? '—'}</dd>
            </div>
          </dl>
        )}
        <div className="border-l border-accent-muted pl-12">
          <h3 className="mb-4 text-caption font-semibold text-accent">
            <Trans>What to check in the replay</Trans>
          </h3>
          <p className="text-body text-gray-800">{selected.review}</p>
        </div>
        {scenario.evidence.length > 0 && (
          <div className="flex flex-col gap-8">
            <p className="text-caption font-semibold text-gray-700">
              <Trans>Open an example round</Trans>
            </p>
            <div className="flex flex-wrap gap-8">
              {scenario.evidence.map((item) => {
                const round = item.roundNumber;
                const query = new URLSearchParams({ player: steamId, tick: String(item.tick) });
                return (
                  <Link
                    key={`${item.checksum}:${round}`}
                    to={`${buildMatch2dViewerRoundPath(item.checksum, round)}?${query}`}
                    className="rounded-8 border border-accent-muted px-10 py-8 text-caption text-accent hover:bg-accent-soft"
                  >
                    {item.mapName} · <Trans>Round {round}</Trans> · {item.side === TeamNumber.CT ? 'CT' : 'T'}
                    {' · '}
                    {item.won ? <Trans>Won</Trans> : <Trans>Lost</Trans>}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
