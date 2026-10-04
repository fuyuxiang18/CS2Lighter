import type { PersonalMatchStats } from 'csdm/common/types/personal-stats';
import { db } from 'csdm/node/database/database';
import { buildPersonalMatchStats } from './build-personal-match-stats';

export async function computePersonalMatchStats(checksum: string): Promise<PersonalMatchStats[]> {
  const [demo, match, players, rounds, economies, kills, damages, shots, clutches, blinds, plants, defuses] =
    await Promise.all([
      db.selectFrom('demos').selectAll().where('checksum', '=', checksum).executeTakeFirstOrThrow(),
      db.selectFrom('matches').selectAll().where('checksum', '=', checksum).executeTakeFirstOrThrow(),
      db
        .selectFrom('players')
        .select(['steam_id', 'name', 'team_name'])
        .where('match_checksum', '=', checksum)
        .execute(),
      db.selectFrom('rounds').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('player_economies').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('kills').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('damages').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('shots').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('clutches').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('player_blinds').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('bombs_planted').selectAll().where('match_checksum', '=', checksum).execute(),
      db.selectFrom('bombs_defused').selectAll().where('match_checksum', '=', checksum).execute(),
    ]);
  return buildPersonalMatchStats({
    demo,
    match,
    players,
    rounds,
    economies,
    kills,
    damages,
    shots,
    clutches,
    blinds,
    plants,
    defuses,
  });
}
