import { db } from 'csdm/node/database/database';
import type { PlayerPosition } from 'csdm/common/types/player-position';
import { playerPositionRowToPlayerPosition } from './player-position-row-to-player-position';
import { fillMissingTicks } from 'csdm/common/array/fill-missing-ticks';
import { readPositionRows } from './read-position-rows';

export async function fetchPlayersPositions(
  checksum: string,
  roundNumber: number,
  window?: { startTick: number; endTick: number },
) {
  const rows = await readPositionRows({ checksum, roundNumber, windows: window === undefined ? undefined : [window] });
  const ids = [...new Set(rows.map((row) => row.player_steam_id))];
  const overrides =
    ids.length === 0
      ? []
      : await db
          .selectFrom('steam_account_overrides')
          .select(['steam_id', 'name'])
          .where('steam_id', 'in', ids)
          .execute();
  const names = new Map(overrides.map((row) => [row.steam_id, row.name]));
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = `${row.tick}:${row.player_steam_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    row.player_name = names.get(row.player_steam_id) ?? row.player_name;
    return true;
  });
  const observed = unique.map(playerPositionRowToPlayerPosition);
  const playerPositions: PlayerPosition[] = window === undefined ? fillMissingTicks(observed) : observed;
  return playerPositions;
}
