import { createHash } from 'node:crypto';
import { db } from 'csdm/node/database/database';
import { Game } from 'csdm/common/types/counter-strike';
import type { DemoCacheMatch } from 'csdm/common/types/demo-data-cache';
import { getMapLowerRadarFilePath } from 'csdm/node/filesystem/maps/get-map-lower-radar-file-path';
import { DEMO_CACHE_SCHEMA_VERSION } from './cache-storage';

export async function getDemoCacheDescriptor(checksum: string) {
  const row = await db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .select([
      'm.checksum',
      'm.demo_path',
      'm.analyze_date',
      'm.game_mode_str',
      'd.date',
      'd.map_name',
      'd.build_number',
      'd.source',
      'd.tickrate',
      'd.game',
    ])
    .where('m.checksum', '=', checksum)
    .executeTakeFirst();
  if (!row || row.game !== Game.CS2) throw new Error('The CS2 match is no longer available');
  const map = await db
    .selectFrom('maps')
    .select('threshold_z')
    .where('name', '=', row.map_name)
    .where('game', '=', Game.CS2)
    .executeTakeFirst();
  const lowerRadar = await getMapLowerRadarFilePath(row.map_name, Game.CS2);
  const match: DemoCacheMatch = {
    checksum,
    demoPath: row.demo_path,
    date: row.date.toISOString(),
    analyzeDate: row.analyze_date.toISOString(),
    mapName: row.map_name,
    buildNumber: row.build_number,
    gameMode: row.game_mode_str,
    source: row.source,
    tickrate: row.tickrate,
    floorThresholdZ: map?.threshold_z,
    singleLevelMap: map?.threshold_z === 0 && lowerRadar === undefined,
  };
  const revision = createHash('sha256')
    .update(JSON.stringify([DEMO_CACHE_SCHEMA_VERSION, match]))
    .digest('hex');
  return { match, revision };
}
