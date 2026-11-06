import type { Insertable } from 'kysely';
import type { PlayerPositionRow } from './player-position-table';
import type { PositionBlockTable } from './position-block-table';
import { encodePositionBlock, positionBlockMaximumRows } from './position-block-codec';
import { positionFromCsv } from './position-csv';
import { streamPositionCsv } from './stream-position-csv';

/** Synchronous row consumption, asynchronous bounded flushes: avoid a promise and iterator yield per CSV row. */
export async function streamPositionBlocks(
  csvFilePath: string,
  consume: (block: Omit<Insertable<PositionBlockTable>, 'id'>) => Promise<void>,
) {
  const groups = new Map<string, PlayerPositionRow[]>();
  let pendingRows = 0;
  let pendingBytes = 0;
  let ordinal = 0;
  let checksum: string | undefined;

  async function flush(key: string, rows: PlayerPositionRow[]) {
    await consume(await encodePositionBlock(rows));
    groups.delete(key);
    pendingRows -= rows.length;
  }
  async function flushAll() {
    for (const [key, rows] of groups) await flush(key, rows);
    pendingBytes = 0;
  }
  await streamPositionCsv(csvFilePath, (columns, recordBytes) => {
    const row = positionFromCsv(columns, ++ordinal);
    checksum ??= row.match_checksum;
    if (row.match_checksum !== checksum) throw new Error('Position CSV contains multiple matches');
    const key = `${row.round_number}:${row.player_steam_id}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
    pendingRows++;
    pendingBytes += recordBytes;
    if (pendingRows >= 16384 || pendingBytes >= 2 * 1024 * 1024) return flushAll();
    if (rows.length === positionBlockMaximumRows) return flush(key, rows);
  });
  await flushAll();
}
