import type { DemoSource, EconomyType, GameMode, TeamNumber } from './counter-strike';

export type PersonalStatsSide = typeof TeamNumber.T | typeof TeamNumber.CT;
type PersonalMatchResult = 'win' | 'loss' | 'tie' | 'unknown';

export type PersonalWeaponStats = {
  weapon: string;
  kills: number;
  headshotKills: number;
  damage: number;
  shots: number;
};

/** Small additive facts, cached once per demo; no positions or inferred aim scores. */
export type PersonalRoundStats = {
  roundNumber: number;
  startTick: number;
  openingKillTick: number | null;
  openingDeathTick: number | null;
  deathTick: number | null;
  teamFlashTick: number | null;
  clutchTick: number | null;
  side: PersonalStatsSide;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damage: number;
  utilityDamage: number;
  friendlyDamage: number;
  flashAssists: number;
  tradeKills: number;
  tradedDeaths: number;
  openingKill: boolean;
  openingDeath: boolean;
  survived: boolean;
  kast: boolean;
  clutchOpponents: number | null;
  clutchWon: boolean;
  bombPlants: number;
  bombDefuses: number;
  flashesThrown: number;
  smokesThrown: number;
  heThrown: number;
  fireThrown: number;
  decoysThrown: number;
  enemiesFlashed: number;
  enemyBlindSeconds: number;
  teammatesFlashed: number;
  economyType: EconomyType | null;
  equipmentValue: number | null;
  moneySpent: number | null;
  /** FACEIT 2025 public damage/objective rules; null for undefined zero-damage or missing-objective rounds. */
  rws: number | null;
  weapons: PersonalWeaponStats[];
};

export type PersonalMatchStats = {
  checksum: string;
  steamId: string;
  name: string;
  date: string;
  mapName: string;
  source: DemoSource;
  gameMode: GameMode;
  buildNumber: number;
  tickrate: number;
  result: PersonalMatchResult;
  /** Competitive metadata or verified 5v5 structure permits the historical model, never Wingman/respawn. */
  ratingEligible: boolean;
  ratingEligibilityBasis: 'mode' | 'observed-5v5' | null;
  /** Available complete rounds in the demo, including rounds this player may not have played. */
  demoRoundCount: number;
  rounds: PersonalRoundStats[];
};

export type PersonalMetrics = {
  roundCount: number;
  roundWins: number;
  roundWinPercentage: number | null;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  headshotPercentage: number | null;
  kd: number | null;
  kda: number | null;
  killsPerRound: number | null;
  deathsPerRound: number | null;
  damage: number;
  adr: number | null;
  utilityDamage: number;
  utilityDamagePerRound: number | null;
  friendlyDamage: number;
  kastRoundCount: number;
  kastPercentage: number | null;
  survivedRoundCount: number;
  survivalPercentage: number | null;
  /** Historical public formula, never the proprietary HLTV 2.x/3.0 rating. */
  hltvRating1: number | null;
  ratingRoundCount: number;
  rws: number | null;
  rwsRoundCount: number;
  rwsMissingRoundCount: number;
  openingKills: number;
  openingDeaths: number;
  openingAttempts: number;
  openingSuccessPercentage: number | null;
  openingAttemptPercentage: number | null;
  openingKillRoundWins: number;
  openingConversionPercentage: number | null;
  tradeKills: number;
  tradedDeaths: number;
  tradedDeathPercentage: number | null;
  flashAssists: number;
  clutchAttempts: number;
  clutchWins: number;
  clutchWinPercentage: number | null;
  /** Index 0..5 is exact kills in a round; 5 also includes >5 in nonstandard modes. */
  multiKills: [number, number, number, number, number, number];
  bombPlants: number;
  bombDefuses: number;
  flashesThrown: number;
  smokesThrown: number;
  heThrown: number;
  fireThrown: number;
  decoysThrown: number;
  enemiesFlashed: number;
  enemyBlindSeconds: number;
  teammatesFlashed: number;
  enemiesPerFlash: number | null;
  equipmentValue: number;
  moneySpent: number;
  economyRoundCount: number;
  averageEquipmentValue: number | null;
  averageMoneySpent: number | null;
};

export type PersonalStatsGroup = {
  key: string;
  matchCount: number;
  matchWins: number;
  matchWinPercentage: number | null;
  metrics: PersonalMetrics;
};

type PersonalStatsMatchSummary = Omit<PersonalMatchStats, 'rounds'> & {
  metrics: PersonalMetrics;
  firstRound: number | null;
  firstTick: number | null;
};

export type FetchPersonalStatsPayload = {
  steamId: string;
  mapName?: string;
  source?: DemoSource;
  side?: PersonalStatsSide;
};

export type PersonalStatsSummary = {
  steamId: string;
  matchCount: number;
  matchWins: number;
  matchLosses: number;
  matchTies: number;
  unknownResults: number;
  matchWinPercentage: number | null;
  /** Ratios use summed numerators/denominators; matches are never averaged equally. */
  metrics: PersonalMetrics;
  mapNames: string[];
  byMap: PersonalStatsGroup[];
  bySide: PersonalStatsGroup[];
  byEconomy: PersonalStatsGroup[];
  byClutchSize: { opponents: number; attempts: number; wins: number; winPercentage: number | null }[];
  weapons: PersonalWeaponStats[];
  matches: PersonalStatsMatchSummary[];
  cohorts: { mapName: string; buildNumber: number; gameMode: GameMode; source: DemoSource; matchCount: number }[];
  coverage: { availableMatches: number; analyzedMatches: number; skippedMatches: number };
  methodology: { rating: 'hltv-1.0-public'; rws: 'faceit-2025-public-local-v1'; tradeWindowSeconds: 5 };
};
