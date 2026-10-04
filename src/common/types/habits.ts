import type { DemoSource, TeamNumber } from 'csdm/common/types/counter-strike';

export type HabitsIdentityCandidate = {
  steamId: string;
  nickname: string;
  matchCount: number;
  lastSeen: string;
};

export type FindHabitsIdentityPayload = { nickname: string };

export type FetchHabitsPayload = {
  steamId: string;
  mapName?: string;
  side?: typeof TeamNumber.T | typeof TeamNumber.CT;
  source?: DemoSource;
};

export type HabitsEvidence = {
  checksum: string;
  roundNumber: number;
  tick: number;
  mapName: string;
  date: string;
  side: TeamNumber;
  kind: 'position' | 'opening' | 'kill' | 'death';
  x: number;
  y: number;
  z: number;
};

export type HabitsPositionBin = {
  x: number;
  y: number;
  z: number;
  seconds: number;
  openingSeconds: number;
  roundCount: number;
  openingRoundCount: number;
  level: 'upper' | 'lower' | null;
  evidence: HabitsEvidence[];
  openingEvidence: HabitsEvidence[];
};

export type HabitsCohort = {
  mapName: string;
  buildNumber: number;
  gameMode: string;
  source: DemoSource;
  matchCount: number;
  roundCount: number;
  positionRoundCount: number;
  observedSeconds: number;
  openingSeconds: number;
  kills: number;
  deaths: number;
  openingKills: number;
  openingDeaths: number;
  bins: HabitsPositionBin[];
};

export type HabitsSummary = {
  steamId: string;
  mapNames: string[];
  matchCount: number;
  roundCount: number;
  matchesWithPositions: number;
  positionRoundCount: number;
  observedSeconds: number;
  kills: number;
  deaths: number;
  openingKills: number;
  openingDeaths: number;
  cohorts: HabitsCohort[];
  evidence: HabitsEvidence[];
  evidenceTotalCount: number;
  gridSize: number;
  openingWindowSeconds: number;
  maximumPositionGapSeconds: number;
};
