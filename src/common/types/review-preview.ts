import type { PlayerPosition } from './player-position';

export type ReviewPreviewRequest = { checksum: string; roundNumber: number; startTick: number; endTick: number };
export type ReviewPreviewPosition = Pick<
  PlayerPosition,
  'tick' | 'x' | 'y' | 'z' | 'yaw' | 'health' | 'isAlive' | 'side' | 'playerSteamId' | 'playerName'
>;
export type ReviewPreview = {
  startTick: number;
  endTick: number;
  tickrate: number;
  positions: ReviewPreviewPosition[];
};
