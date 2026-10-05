import type { DemoSource } from './counter-strike';
import type { PersonalStatsSide } from './personal-stats';

export type ReviewDuelsPayload = {
  steamId: string;
  checksum?: string;
  mapName?: string;
  side?: PersonalStatsSide;
  source?: DemoSource;
  filter?: 'all' | 'opening' | 'kills' | 'deaths' | 'damage';
  page?: number;
};
export type ReviewDuel = {
  id: string;
  checksum: string;
  steamId: string;
  mapName: string;
  date: string;
  roundNumber: number;
  side: PersonalStatsSide;
  startTick: number;
  eventTick: number;
  endTick: number;
  opponent: string;
  opponentSteamId: string;
  weapon: string;
  kind: 'kill' | 'death' | 'damage';
  opening: boolean;
  headshot: boolean;
  damageGiven: number;
  damageTaken: number;
};
export type ReviewDuelsPage = {
  events: ReviewDuel[];
  total: number;
  page: number;
  pageSize: number;
  openingKills: number;
  openingDeaths: number;
  coverage: 'kills-deaths-damage';
};
