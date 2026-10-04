import { db } from 'csdm/node/database/database';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { DemoCacheMatch, CachedPlayerHabits } from 'csdm/common/types/demo-data-cache';
import { createHabitsAccumulator } from 'csdm/node/database/habits/aggregate-habits';
import { fetchKills } from 'csdm/node/database/kills/fetch-kills';

export async function buildDemoHabits(match: DemoCacheMatch): Promise<Record<string, CachedPlayerHabits>> {
  const players = await db
    .selectFrom('players')
    .select('steam_id')
    .where('match_checksum', '=', match.checksum)
    .distinct()
    .execute();
  const kills = await fetchKills(match.checksum);
  const result: Record<string, CachedPlayerHabits> = {};
  // Bound memory to one player's observations. The resulting file contains bins and evidence only.
  for (const { steam_id: steamId } of players) {
    const rounds = await db
      .selectFrom('rounds as r')
      .innerJoin('player_economies as e', (join) =>
        join.onRef('e.match_checksum', '=', 'r.match_checksum').onRef('e.round_number', '=', 'r.number'),
      )
      .select(['r.number', 'r.freeze_time_end_tick as freezeEndTick', 'r.end_tick as endTick', 'e.player_side as side'])
      .where('r.match_checksum', '=', match.checksum)
      .where('e.player_steam_id', '=', steamId)
      .distinct()
      .execute();
    const positions = await db
      .selectFrom('player_positions')
      .select(['round_number as roundNumber', 'tick', 'side', 'is_alive as isAlive', 'x', 'y', 'z'])
      .where('match_checksum', '=', match.checksum)
      .where('player_steam_id', '=', steamId)
      .distinctOn(['round_number', 'tick'])
      .orderBy('round_number')
      .orderBy('tick')
      .orderBy('id')
      .execute();
    const input = { ...match, rounds, positions, kills };
    const all = createHabitsAccumulator(steamId, undefined, [match.mapName]);
    const t = createHabitsAccumulator(steamId, TeamNumber.T, [match.mapName]);
    const ct = createHabitsAccumulator(steamId, TeamNumber.CT, [match.mapName]);
    all.addMatch(input);
    t.addMatch(input);
    ct.addMatch(input);
    result[steamId] = { all: all.summary, t: t.summary, ct: ct.summary };
  }
  return result;
}
