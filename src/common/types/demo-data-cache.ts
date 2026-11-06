import type { DemoSource } from './counter-strike';
import type { HabitsSummary } from './habits';
import type { PersonalMatchStats } from './personal-stats';

export type DemoCacheDirectory = {
  path: string;
  preferredPath: string;
  isFallback: boolean;
  reason?: string;
};

export type DemoCacheMatch = {
  checksum: string;
  demoPath: string;
  date: string;
  analyzeDate: string;
  mapName: string;
  buildNumber: number;
  gameMode: string;
  source: DemoSource;
  tickrate: number;
  floorThresholdZ?: number;
  singleLevelMap: boolean;
};

export type CachedPlayerHabits = { all: HabitsSummary; t: HabitsSummary; ct: HabitsSummary };

export type DemoDataCache = {
  format: 'cs2-parser-demo-data';
  schemaVersion: number;
  checksum: string;
  revision: string;
  generatedAt: string;
  contentHash?: string;
  /** Absent in schema-3 files created before 0.8.0: both calculations used revision 1. */
  calculations?: { habits: number; metrics: number };
  match: DemoCacheMatch;
  habitsBySteamId: Record<string, CachedPlayerHabits>;
  // Per-match facts are added by the personal-statistics module, never raw position samples.
  metrics: PersonalMatchStats[];
};
