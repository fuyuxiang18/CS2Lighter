import { db } from 'csdm/node/database/database';
import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type { FetchHabitsPayload, HabitsSummary } from 'csdm/common/types/habits';
import { fetchKills } from 'csdm/node/database/kills/fetch-kills';
import { getMapLowerRadarFilePath } from 'csdm/node/filesystem/maps/get-map-lower-radar-file-path';
import { createHabitsAccumulator } from './aggregate-habits';

export async function fetchHabitsSummary(payload: FetchHabitsPayload): Promise<HabitsSummary> {
  if (typeof payload.steamId !== 'string' || !/^\d{17}$/.test(payload.steamId)) {
    throw new Error('A valid SteamID is required');
  }
  if (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT) {
    throw new Error('Invalid habits side filter');
  }

  // Identity, not nickname or a source guess, defines the personal library.
  // Unknown source metadata must not hide locally imported Perfect World demos.
  const matches = await db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'm.checksum')
    .select([
      'm.checksum',
      'd.date',
      'd.map_name as mapName',
      'd.build_number as buildNumber',
      'd.tickrate',
      'm.game_mode_str as gameMode',
      'd.source',
    ])
    .distinct()
    .where('p.steam_id', '=', payload.steamId)
    .where('d.game', '=', Game.CS2)
    .orderBy('d.date', 'desc')
    .orderBy('m.checksum')
    .execute();

  const mapNames = [...new Set(matches.map((match) => match.mapName))].sort();
  const maps = await db.selectFrom('maps').select(['name', 'threshold_z']).where('game', '=', Game.CS2).execute();
  const floorMetadata = new Map(
    await Promise.all(
      maps.map(async (map) => {
        const lowerRadar = await getMapLowerRadarFilePath(map.name, Game.CS2);
        return [
          map.name,
          {
            floorThresholdZ: map.threshold_z,
            singleLevelMap: map.threshold_z === 0 && lowerRadar === undefined,
          },
        ] as const;
      }),
    ),
  );
  const accumulator = createHabitsAccumulator(payload.steamId, payload.side, mapNames);
  for (const match of matches) {
    if ((payload.mapName && match.mapName !== payload.mapName) || (payload.source && match.source !== payload.source)) {
      continue;
    }
    const [rounds, positions, kills] = await Promise.all([
      db
        .selectFrom('rounds as r')
        .innerJoin('player_economies as e', (join) =>
          join.onRef('e.match_checksum', '=', 'r.match_checksum').onRef('e.round_number', '=', 'r.number'),
        )
        .select([
          'r.number',
          'r.freeze_time_end_tick as freezeEndTick',
          'r.end_tick as endTick',
          'e.player_side as side',
        ])
        .where('r.match_checksum', '=', match.checksum)
        .where('e.player_steam_id', '=', payload.steamId)
        .distinct()
        .execute(),
      // Read the existing positions table, but never the viewer's synthetic fillMissingTicks output.
      // Process one match at a time to avoid loading an entire personal library's tick rows into memory.
      db
        .selectFrom('player_positions')
        .select(['round_number as roundNumber', 'tick', 'side', 'is_alive as isAlive', 'x', 'y', 'z'])
        .where('match_checksum', '=', match.checksum)
        .where('player_steam_id', '=', payload.steamId)
        .distinctOn(['round_number', 'tick'])
        .orderBy('round_number')
        .orderBy('tick')
        .orderBy('id')
        .execute(),
      fetchKills(match.checksum),
    ]);
    accumulator.addMatch({
      ...match,
      ...floorMetadata.get(match.mapName),
      date: match.date.toISOString(),
      rounds,
      positions,
      kills,
    });
  }
  return accumulator.summary;
}
