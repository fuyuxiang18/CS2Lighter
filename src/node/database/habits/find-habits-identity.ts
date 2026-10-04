import { db } from 'csdm/node/database/database';
import { Game } from 'csdm/common/types/counter-strike';
import type { HabitsIdentityCandidate } from 'csdm/common/types/habits';
import { aggregateHabitsIdentities } from './aggregate-habits-identities';

export async function findHabitsIdentity(nickname: string): Promise<HabitsIdentityCandidate[]> {
  if (typeof nickname !== 'string' || nickname.trim().length === 0 || nickname.length > 128) {
    return [];
  }

  // Original demo names only: an account display override must not silently bind an identity.
  const rows = await db
    .selectFrom('players as p')
    .innerJoin('demos as d', 'd.checksum', 'p.match_checksum')
    .innerJoin('matches as m', 'm.checksum', 'p.match_checksum')
    .select(['p.steam_id as steamId', 'd.checksum', 'd.date'])
    .where('p.name', '=', nickname)
    .where('d.game', '=', Game.CS2)
    .orderBy('d.date', 'desc')
    .execute();

  return aggregateHabitsIdentities(nickname, rows);
}
