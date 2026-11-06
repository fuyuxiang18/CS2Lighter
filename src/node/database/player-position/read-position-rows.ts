import { db } from 'csdm/node/database/database';
import type { PlayerPositionRow } from './player-position-table';
import { decodePositionBlock } from './position-block-codec';

type PositionWindow = { startTick: number; endTick: number };
type Options = {
  checksum: string;
  roundNumber: number;
  steamId?: string;
  windows?: PositionWindow[];
  limit?: number;
  signal?: AbortSignal;
};

export async function hasPackedPositions(checksum: string): Promise<boolean> {
  return (
    (await db
      .selectFrom('player_position_blocks')
      .select('id')
      .where('match_checksum', '=', checksum)
      .limit(1)
      .executeTakeFirst()) !== undefined
  );
}

function comparePositionRows(a: PlayerPositionRow, b: PlayerPositionRow) {
  return (
    a.tick - b.tick ||
    a.frame - b.frame ||
    a.player_steam_id.localeCompare(b.player_steam_id) ||
    (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0)
  );
}

/** Indexed round/window reads. Legacy rows remain the fallback, including empty and partially imported rounds. */
export async function readPositionRows({
  checksum,
  roundNumber,
  steamId,
  windows,
  limit,
  signal,
}: Options): Promise<PlayerPositionRow[]> {
  signal?.throwIfAborted();
  let blocksQuery = db
    .selectFrom('player_position_blocks')
    .selectAll()
    .where('match_checksum', '=', checksum)
    .where('round_number', '=', roundNumber);
  if (steamId !== undefined) blocksQuery = blocksQuery.where('player_steam_id', '=', steamId);
  if (windows !== undefined) {
    if (windows.length === 0) return [];
    blocksQuery = blocksQuery.where((eb) =>
      eb.or(
        windows.map((window) =>
          eb.and([eb('last_tick', '>=', window.startTick), eb('first_tick', '<=', window.endTick)]),
        ),
      ),
    );
  }
  const blocks = await blocksQuery.orderBy('id').execute();
  signal?.throwIfAborted();
  if (blocks.length > 0) {
    const rows: PlayerPositionRow[] = [];
    for (const block of blocks) {
      signal?.throwIfAborted();
      for (const row of await decodePositionBlock(block)) {
        if (
          windows === undefined ||
          windows.some((window) => row.tick >= window.startTick && row.tick <= window.endTick)
        )
          rows.push(row);
      }
      // Death review rejects oversize results instead of consuming a silently truncated evidence set.
      if (limit !== undefined && rows.length > limit) break;
    }
    rows.sort(comparePositionRows);
    return limit === undefined ? rows : rows.slice(0, limit);
  }
  let legacy = db
    .selectFrom('player_positions')
    .selectAll()
    .where('match_checksum', '=', checksum)
    .where('round_number', '=', roundNumber);
  if (steamId !== undefined) legacy = legacy.where('player_steam_id', '=', steamId);
  if (windows !== undefined)
    legacy = legacy.where((eb) =>
      eb.or(windows.map((window) => eb.and([eb('tick', '>=', window.startTick), eb('tick', '<=', window.endTick)]))),
    );
  legacy = legacy.orderBy('tick').orderBy('frame').orderBy('player_steam_id');
  if (limit !== undefined) legacy = legacy.limit(limit);
  const rows = await legacy.execute();
  signal?.throwIfAborted();
  return rows;
}
