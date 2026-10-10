import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats, PersonalRoundStats } from 'csdm/common/types/personal-stats';
import type { TacticalAnalysis, TacticalScenario, TacticalScenarioCode } from 'csdm/common/types/tactical-analysis';
import { percent } from './personal-metrics';

type Context = { match: PersonalMatchStats; round: PersonalRoundStats };
type Definition = {
  code: TacticalScenarioCode;
  eligible: (context: Context) => boolean;
  matches: (context: Context) => boolean;
  eventTick?: (round: PersonalRoundStats) => number | null;
  won?: (round: PersonalRoundStats) => boolean;
};

function validTick(tick: number | null): tick is number {
  return tick !== null && Number.isFinite(tick) && tick >= 0;
}

function hasOpeningTiming({ match, round }: Context): boolean {
  if (
    !round.openingKill ||
    !validTick(round.startTick) ||
    !validTick(round.openingKillTick) ||
    round.openingKillTick < round.startTick ||
    !Number.isFinite(match.tickrate) ||
    match.tickrate <= 0
  )
    return false;
  // Missing death times cannot count as safely surviving the next ten seconds.
  return (
    (round.survived && round.deaths === 0) ||
    (!round.survived && round.deaths === 1 && validTick(round.deathTick) && round.deathTick >= round.openingKillTick)
  );
}

function openingKill({ round }: Context) {
  return round.openingKill;
}

function openingDeath({ round }: Context) {
  return round.openingDeath;
}

function anyRound() {
  return true;
}

function threwFlash({ round }: Context) {
  return round.flashesThrown > 0;
}

function threwDamageUtility({ round }: Context) {
  return round.heThrown + round.fireThrown > 0;
}

function planted({ round }: Context) {
  return round.side === TeamNumber.T && round.bombPlants > 0;
}

function lowEquipment({ round }: Context) {
  return (
    round.equipmentValue !== null &&
    Number.isFinite(round.equipmentValue) &&
    round.equipmentValue >= 0 &&
    round.equipmentValue <= 2000
  );
}

function openingTick(round: PersonalRoundStats) {
  return round.openingKillTick;
}

function openingDeathTick(round: PersonalRoundStats) {
  return round.openingDeathTick;
}

function clutchTick(round: PersonalRoundStats) {
  return round.clutchTick;
}

function clutch({ round }: Context) {
  return (
    round.clutchOpponents !== null &&
    Number.isInteger(round.clutchOpponents) &&
    round.clutchOpponents >= 1 &&
    round.clutchOpponents <= 5
  );
}

const definitions: Definition[] = [
  {
    code: 'opening-kill-survived',
    eligible: openingKill,
    matches: ({ round }) => round.survived,
    eventTick: openingTick,
  },
  {
    code: 'opening-kill-died',
    eligible: openingKill,
    matches: ({ round }) => !round.survived,
    eventTick: openingTick,
  },
  {
    code: 'opening-kill-quick-death',
    eligible: hasOpeningTiming,
    matches: ({ match, round }) =>
      !round.survived &&
      round.deathTick !== null &&
      round.openingKillTick !== null &&
      round.deathTick - round.openingKillTick <= 10 * match.tickrate,
    eventTick: openingTick,
  },
  {
    code: 'opening-death-traded',
    eligible: openingDeath,
    matches: ({ round }) => round.tradedDeaths > 0,
    eventTick: openingDeathTick,
  },
  {
    code: 'opening-death-untraded',
    eligible: openingDeath,
    matches: ({ round }) => round.tradedDeaths === 0,
    eventTick: openingDeathTick,
  },
  {
    code: 'trade-kill-round',
    eligible: anyRound,
    matches: ({ round }) => round.tradeKills > 0,
  },
  {
    code: 'flash-assist-round',
    eligible: anyRound,
    matches: ({ round }) => round.flashAssists > 0,
  },
  {
    code: 'flash-without-long-enemy-blind',
    eligible: threwFlash,
    matches: ({ round }) => round.enemiesFlashed === 0,
  },
  {
    code: 'teammate-flash-round',
    eligible: threwFlash,
    matches: ({ round }) => round.teammatesFlashed > 0,
    eventTick: (round) => round.teamFlashTick,
  },
  {
    code: 'damage-utility-hit',
    eligible: threwDamageUtility,
    matches: ({ round }) => round.utilityDamage > 0,
  },
  {
    code: 'damage-utility-no-damage',
    eligible: threwDamageUtility,
    matches: ({ round }) => round.utilityDamage === 0,
  },
  { code: 'personal-plant-won', eligible: planted, matches: ({ round }) => round.won },
  { code: 'personal-plant-lost', eligible: planted, matches: ({ round }) => !round.won },
  {
    code: 'clutch-1v1',
    eligible: clutch,
    matches: ({ round }) => round.clutchOpponents === 1,
    eventTick: clutchTick,
    won: (round) => round.clutchWon,
  },
  {
    code: 'clutch-1v2plus',
    eligible: clutch,
    matches: ({ round }) => round.clutchOpponents !== null && round.clutchOpponents >= 2,
    eventTick: clutchTick,
    won: (round) => round.clutchWon,
  },
  { code: 'low-equipment-damage', eligible: lowEquipment, matches: ({ round }) => round.damage > 0 },
  { code: 'low-equipment-no-damage', eligible: lowEquipment, matches: ({ round }) => round.damage === 0 },
];

function evidence(contexts: Context[], definition: Definition): TacticalScenario['evidence'] {
  const replayable = contexts.filter(
    ({ round }) => Number.isInteger(round.roundNumber) && round.roundNumber > 0 && validTick(round.startTick),
  );
  const won = ({ round }: Context) => definition.won?.(round) ?? round.won;
  const selected = new Set([
    ...replayable.filter(won).slice(0, 3),
    ...replayable.filter((context) => !won(context)).slice(0, 3),
  ]);
  for (const context of replayable) {
    if (selected.size >= 6) break;
    selected.add(context);
  }
  return replayable
    .filter((context) => selected.has(context))
    .map(({ match, round }) => {
      const eventTick = definition.eventTick?.(round) ?? null;
      const hasContext =
        validTick(eventTick) && eventTick >= round.startTick && Number.isFinite(match.tickrate) && match.tickrate > 0;
      return {
        checksum: match.checksum,
        mapName: match.mapName,
        roundNumber: round.roundNumber,
        side: round.side,
        won: definition.won?.(round) ?? round.won,
        tick: hasContext ? Math.max(round.startTick, Math.floor(eventTick - 8 * match.tickrate)) : round.startTick,
      };
    });
}

/** Pure read-time aggregation: does not change saved demo facts or require another demo parse. */
export function buildTacticalAnalysis(matches: PersonalMatchStats[]): TacticalAnalysis {
  const contexts = matches
    .filter((match) => match.ratingEligible)
    .toSorted((a, b) => b.date.localeCompare(a.date) || a.checksum.localeCompare(b.checksum))
    .flatMap((match) =>
      match.rounds
        .filter((round) => round.side === TeamNumber.T || round.side === TeamNumber.CT)
        .toSorted((a, b) => a.roundNumber - b.roundNumber)
        .map((round) => ({ match, round })),
    );
  return {
    scenarios: definitions.map((definition) => {
      const eligible = contexts.filter(definition.eligible);
      const matching = eligible.filter(definition.matches);
      const wins = matching.filter(({ round }) => definition.won?.(round) ?? round.won).length;
      return {
        code: definition.code,
        frequency: {
          count: matching.length,
          total: eligible.length,
          percentage: percent(matching.length, eligible.length),
        },
        wins,
        winPercentage: percent(wins, matching.length),
        adr:
          matching.length > 0 ? matching.reduce((total, { round }) => total + round.damage, 0) / matching.length : null,
        evidence: evidence(matching, definition),
      };
    }),
  };
}
