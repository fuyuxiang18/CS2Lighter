import type { PersonalAnalysisEvidence, PersonalRate } from './personal-analysis';

export type TacticalScenarioCode =
  | 'opening-kill-survived'
  | 'opening-kill-died'
  | 'opening-kill-quick-death'
  | 'opening-death-traded'
  | 'opening-death-untraded'
  | 'trade-kill-round'
  | 'flash-assist-round'
  | 'flash-without-long-enemy-blind'
  | 'teammate-flash-round'
  | 'damage-utility-hit'
  | 'damage-utility-no-damage'
  | 'personal-plant-won'
  | 'personal-plant-lost'
  | 'clutch-1v1'
  | 'clutch-1v2plus'
  | 'low-equipment-damage'
  | 'low-equipment-no-damage';

export type TacticalScenario = {
  code: TacticalScenarioCode;
  /** Matching rounds over the scenario's eligible rounds; never a per-event probability. */
  frequency: PersonalRate;
  /** Team round wins among matching rounds; recorded clutch wins for clutch scenarios. */
  wins: number;
  winPercentage: number | null;
  /** Enemy health damage per matching round. */
  adr: number | null;
  /** Up to six examples: first reserve three wins and three losses, then fill in stable match/round order. */
  evidence: (PersonalAnalysisEvidence & { won: boolean })[];
};

export type TacticalAnalysis = { scenarios: TacticalScenario[] };
