import { db } from 'csdm/node/database/database';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { DemoCacheMatch, CachedPlayerHabits } from 'csdm/common/types/demo-data-cache';
import { createHabitsAccumulator } from 'csdm/node/database/habits/aggregate-habits';
import { fetchKills } from 'csdm/node/database/kills/fetch-kills';
import { sql } from 'kysely';

export async function buildDemoHabits(
  match: DemoCacheMatch,
  signal?: AbortSignal,
): Promise<Record<string, CachedPlayerHabits>> {
  signal?.throwIfAborted();
  const players = await db
    .selectFrom('players')
    .select('steam_id')
    .where('match_checksum', '=', match.checksum)
    .distinct()
    .execute();
  const kills = await fetchKills(match.checksum);
  const result: Record<string, CachedPlayerHabits> = {};
  const allRounds = await db
    .selectFrom('rounds as r')
    .innerJoin('player_economies as e', (join) =>
      join.onRef('e.match_checksum', '=', 'r.match_checksum').onRef('e.round_number', '=', 'r.number'),
    )
    .select([
      'e.player_steam_id as playerSteamId',
      'r.number',
      'r.freeze_time_end_tick as freezeEndTick',
      'r.end_tick as endTick',
      'e.player_side as side',
    ])
    .where('r.match_checksum', '=', match.checksum)
    .distinct()
    .execute();
  type Position = {
    playerSteamId: string;
    roundNumber: number;
    tick: number;
    side: TeamNumber;
    isAlive: boolean;
    x: number;
    y: number;
    z: number;
  };
  const remaining = new Set(players.map((player) => player.steam_id));
  function addPlayer(steamId: string, positions: Position[]) {
    const rounds = allRounds.filter((round) => round.playerSteamId === steamId);
    const input = { ...match, rounds, positions, kills };
    const all = createHabitsAccumulator(steamId, undefined, [match.mapName]);
    const t = createHabitsAccumulator(steamId, TeamNumber.T, [match.mapName]);
    const ct = createHabitsAccumulator(steamId, TeamNumber.CT, [match.mapName]);
    all.addMatch(input);
    t.addMatch(input);
    ct.addMatch(input);
    result[steamId] = { all: all.summary, t: t.summary, ct: ct.summary };
    remaining.delete(steamId);
  }
  // One position scan and one sort for the match, instead of a complete scan for every player.
  // A PostgreSQL cursor keeps JS memory bounded to one player's observations plus one fetch block.
  await db.transaction().execute(async (transaction) => {
    await sql`SET TRANSACTION READ ONLY`.execute(transaction);
    await sql`DECLARE habits_positions_cursor NO SCROLL CURSOR FOR
      SELECT DISTINCT ON (player_steam_id, round_number, tick)
        player_steam_id AS "playerSteamId", round_number AS "roundNumber", tick, side,
        is_alive AS "isAlive", x, y, z
      FROM player_positions WHERE match_checksum = ${match.checksum}
      ORDER BY player_steam_id, round_number, tick, id`.execute(transaction);
    let steamId: string | undefined;
    let positions: Position[] = [];
    while (true) {
      signal?.throwIfAborted();
      const { rows } = await sql<Position>`FETCH FORWARD 20000 FROM habits_positions_cursor`.execute(transaction);
      signal?.throwIfAborted();
      if (rows.length === 0) break;
      for (const row of rows) {
        if (steamId !== row.playerSteamId) {
          if (steamId !== undefined && remaining.has(steamId)) addPlayer(steamId, positions);
          steamId = row.playerSteamId;
          positions = [];
        }
        positions.push(row);
      }
    }
    if (steamId !== undefined && remaining.has(steamId)) addPlayer(steamId, positions);
    await sql`CLOSE habits_positions_cursor`.execute(transaction);
  });
  for (const steamId of remaining) addPlayer(steamId, []);
  return result;
}
