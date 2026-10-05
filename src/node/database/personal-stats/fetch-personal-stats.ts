import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  FetchPersonalStatsPayload,
  PersonalMatchStats,
  PersonalStatsSummary,
} from 'csdm/common/types/personal-stats';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { db } from 'csdm/node/database/database';
import { aggregatePersonalStats } from './aggregate-personal-stats';

export async function fetchPersonalStats(payload: FetchPersonalStatsPayload): Promise<PersonalStatsSummary> {
  if (typeof payload.steamId !== 'string' || !/^\d{17}$/.test(payload.steamId))
    throw new Error('A valid SteamID is required');
  if (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT)
    throw new Error('Invalid personal statistics side filter');
  const library = await db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'm.checksum')
    .select(['m.checksum', 'd.map_name as mapName', 'd.source'])
    .distinct()
    .where('d.game', '=', Game.CS2)
    .where('p.steam_id', '=', payload.steamId)
    .execute();
  const selected = library.filter(
    (match) =>
      (!payload.mapName || match.mapName === payload.mapName) && (!payload.source || match.source === payload.source),
  );
  const facts: PersonalMatchStats[] = [];
  let result: PersonalStatsSummary | undefined;
  await loadDemoCaches(
    selected.map((match) => match.checksum),
    (cache, index, total) => {
      facts.push(...cache.metrics.filter((player) => player.steamId === payload.steamId));
      if (index === total) result = aggregatePersonalStats(facts, payload, selected.length);
    },
    { allowPartial: true },
  );
  const summary = result ?? aggregatePersonalStats(facts, payload, selected.length);
  summary.mapNames = [...new Set(library.map((match) => match.mapName))].sort();
  return summary;
}
