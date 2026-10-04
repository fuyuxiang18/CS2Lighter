import { db } from 'csdm/node/database/database';
import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type { FetchHabitsPayload, HabitsSummary } from 'csdm/common/types/habits';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { createCachedHabitsMerger } from 'csdm/node/demo-cache/merge-cached-habits';

export async function fetchHabitsSummary(payload: FetchHabitsPayload): Promise<HabitsSummary> {
  if (typeof payload.steamId !== 'string' || !/^\d{17}$/.test(payload.steamId)) {
    throw new Error('A valid SteamID is required');
  }
  if (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT) {
    throw new Error('Invalid habits side filter');
  }
  // This small metadata query defines identity and filters. Raw positions are only read on a cache miss.
  const matches = await db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'm.checksum')
    .select(['m.checksum', 'd.map_name as mapName', 'd.source', 'd.date'])
    .distinct()
    .where('p.steam_id', '=', payload.steamId)
    .where('d.game', '=', Game.CS2)
    .orderBy('d.date', 'desc')
    .orderBy('m.checksum')
    .execute();
  const mapNames = [...new Set(matches.map((match) => match.mapName))].sort();
  const merger = createCachedHabitsMerger(payload.steamId, mapNames);
  const selected = matches.filter(
    (match) =>
      (!payload.mapName || match.mapName === payload.mapName) && (!payload.source || match.source === payload.source),
  );
  await loadDemoCaches(
    selected.map((match) => match.checksum),
    (cache) => {
      const player = cache.habitsBySteamId[payload.steamId];
      if (player)
        merger.add(
          cache.checksum,
          payload.side === TeamNumber.T ? player.t : payload.side === TeamNumber.CT ? player.ct : player.all,
        );
    },
  );
  return merger.summary;
}
