import type { DeathRiskVector } from './death-risk';

/** A witnessed departure, not a claim that a reverse route could have been traversed. */
export type DeathRiskPostKillCoverDeparture = {
  id: string;
  actorId: string;
  killEventId: string;
  killedEnemyId: string;
  killTick: number;
  /** The last covered frame; strictly after the kill and immediately before entry. */
  coverTick: number;
  entryTick: number;
  endTick: number;
  coverPosition: DeathRiskVector;
  coverEye: DeathRiskVector;
  entryPosition: DeathRiskVector;
  enemyIds: string[];
  hitEventId: string;
  attackerId: string;
  /** Current map-frame traces, original events and observed position references. */
  sources: string[];
};
