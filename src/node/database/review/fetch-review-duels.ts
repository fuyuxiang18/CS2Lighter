import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type { ReviewDuelsPayload } from 'csdm/common/types/review-duels';
import { db } from '../database';
import { buildReviewDuels } from './build-review-duels';

export async function fetchReviewDuels(payload: ReviewDuelsPayload) {
  if (
    !payload ||
    typeof payload.steamId !== 'string' ||
    !/^\d{17}$/.test(payload.steamId) ||
    (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT) ||
    (payload.page !== undefined && (!Number.isSafeInteger(payload.page) || payload.page < 0)) ||
    (payload.filter !== undefined && !['all', 'opening', 'kills', 'deaths', 'damage'].includes(payload.filter))
  )
    throw new Error('Invalid duel filters');
  let query = db
    .selectFrom('demos as d')
    .innerJoin('matches as m', 'm.checksum', 'd.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'd.checksum')
    .select(['d.checksum', 'd.map_name', 'd.date', 'd.tickrate'])
    .distinct()
    .where('p.steam_id', '=', payload.steamId)
    .where('d.game', '=', Game.CS2);
  if (payload.checksum) query = query.where('d.checksum', '=', payload.checksum);
  if (payload.mapName) query = query.where('d.map_name', '=', payload.mapName);
  if (payload.source) query = query.where('d.source', '=', payload.source);
  const matches = (await query.execute()).filter((match) => match.tickrate > 0 && Number.isFinite(match.tickrate));
  const checksums = matches.map((match) => match.checksum);
  if (!checksums.length) return buildReviewDuels({ matches, kills: [], damages: [], rounds: [] }, payload);
  const [kills, damages, rounds, players, participation] = await Promise.all([
    db.selectFrom('kills').selectAll().where('match_checksum', 'in', checksums).execute(),
    db
      .selectFrom('damages')
      .selectAll()
      .where('match_checksum', 'in', checksums)
      .where((eb) =>
        eb.or([eb('attacker_steam_id', '=', payload.steamId), eb('victim_steam_id', '=', payload.steamId)]),
      )
      .execute(),
    db.selectFrom('rounds').selectAll().where('match_checksum', 'in', checksums).execute(),
    db
      .selectFrom('players')
      .select(['match_checksum', 'steam_id', 'name'])
      .where('match_checksum', 'in', checksums)
      .execute(),
    db
      .selectFrom('player_economies')
      .select(['match_checksum', 'round_number', 'player_side'])
      .where('match_checksum', 'in', checksums)
      .where('player_steam_id', '=', payload.steamId)
      .execute(),
  ]);
  return buildReviewDuels({ matches, kills, damages, rounds, players, participation }, payload);
}
