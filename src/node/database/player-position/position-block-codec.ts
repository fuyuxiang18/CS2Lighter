import { createHash } from 'node:crypto';
import { deflateRaw, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import type { Insertable } from 'kysely';
import type { PlayerPositionRow } from './player-position-table';
import type { PositionBlockTable } from './position-block-table';

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);
export const positionBlockMaximumRows = 2048;
const maximumDecodedBytes = 4 * 1024 * 1024;
const magic = Buffer.from('CSP1');
const numericKeys = [
  'frame',
  'tick',
  'x',
  'y',
  'z',
  'yaw',
  'flash_duration_remaining',
  'side',
  'money',
  'health',
  'armor',
] as const;
const booleanKeys = [
  'is_alive',
  'has_helmet',
  'has_bomb',
  'has_defuse_kit',
  'is_ducking',
  'is_airborne',
  'is_scoping',
  'is_defusing',
  'is_planting',
  'is_grabbing_hostage',
] as const;
const stringKeys = [
  'player_name',
  'active_weapon_name',
  'equipments',
  'grenades',
  'pistols',
  'smgs',
  'rifles',
  'heavy',
] as const;
const recordBytes = 8 + numericKeys.length * 8 + 2 + stringKeys.length * 4;
const nullString = 0xffffffff;
type Block = Omit<Insertable<PositionBlockTable>, 'id'>;

/** Lossless Float64 and integer IDs; no resampling, rounding, interpolation or discarded states. */
export async function encodePositionBlock(rows: PlayerPositionRow[]): Promise<Block> {
  if (rows.length === 0 || rows.length > positionBlockMaximumRows) throw new Error('Invalid position block row count');
  const first = rows[0];
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const records = Buffer.alloc(rows.length * recordBytes);
  let offset = 0;
  let firstTick = Infinity;
  let lastTick = -Infinity;
  for (const row of rows) {
    if (
      row.match_checksum !== first.match_checksum ||
      row.round_number !== first.round_number ||
      row.player_steam_id !== first.player_steam_id
    )
      throw new Error('Position block crosses a player or round');
    firstTick = Math.min(firstTick, row.tick);
    lastTick = Math.max(lastTick, row.tick);
    records.writeBigInt64LE(BigInt(row.id), offset);
    offset += 8;
    for (const key of numericKeys) {
      if (!Number.isFinite(row[key])) throw new Error('Invalid position number');
      records.writeDoubleLE(row[key], offset);
      offset += 8;
    }
    let flags = 0;
    booleanKeys.forEach((key, index) => {
      if (row[key]) flags |= 1 << index;
    });
    records.writeUInt16LE(flags, offset);
    offset += 2;
    for (const key of stringKeys) {
      const value = row[key];
      let index = nullString;
      if (value !== null) {
        const existing = indices.get(value);
        index = existing ?? strings.length;
        if (existing === undefined) {
          strings.push(value);
          indices.set(value, index);
        }
      }
      records.writeUInt32LE(index, offset);
      offset += 4;
    }
  }
  const dictionary = Buffer.from(JSON.stringify(strings));
  const header = Buffer.alloc(12);
  magic.copy(header);
  header.writeUInt32LE(rows.length, 4);
  header.writeUInt32LE(dictionary.length, 8);
  const raw = Buffer.concat([header, dictionary, records]);
  if (raw.length > maximumDecodedBytes) throw new Error('Position block exceeds its decoded size limit');
  const payload = await compress(raw, { level: 3 });
  return {
    match_checksum: first.match_checksum,
    round_number: first.round_number,
    player_steam_id: first.player_steam_id,
    first_tick: firstTick,
    last_tick: lastTick,
    row_count: rows.length,
    payload,
    payload_sha256: createHash('sha256').update(payload).digest('hex'),
  };
}

export async function decodePositionBlock(block: Block): Promise<PlayerPositionRow[]> {
  if (
    block.row_count < 1 ||
    block.row_count > positionBlockMaximumRows ||
    block.payload.length > maximumDecodedBytes ||
    createHash('sha256').update(block.payload).digest('hex') !== block.payload_sha256
  )
    throw new Error('Invalid position block integrity');
  const raw = await decompress(block.payload, { maxOutputLength: maximumDecodedBytes });
  if (raw.length < 12 || !raw.subarray(0, 4).equals(magic) || raw.readUInt32LE(4) !== block.row_count)
    throw new Error('Unsupported or incomplete position block');
  const dictionaryBytes = raw.readUInt32LE(8);
  let offset = 12 + dictionaryBytes;
  if (offset + block.row_count * recordBytes !== raw.length) throw new Error('Invalid position block length');
  const strings: unknown = JSON.parse(raw.subarray(12, offset).toString('utf8'));
  if (!Array.isArray(strings) || !strings.every((value) => typeof value === 'string'))
    throw new Error('Invalid position dictionary');
  const rows: PlayerPositionRow[] = [];
  let firstTick = Infinity;
  let lastTick = -Infinity;
  for (let index = 0; index < block.row_count; index++) {
    const id = raw.readBigInt64LE(offset);
    offset += 8;
    const row = {
      id: Number.isSafeInteger(Number(id)) ? Number(id) : id.toString(),
      match_checksum: block.match_checksum,
      round_number: block.round_number,
      player_steam_id: block.player_steam_id,
    } as PlayerPositionRow;
    for (const key of numericKeys) {
      const value = raw.readDoubleLE(offset);
      if (!Number.isFinite(value)) throw new Error('Invalid decoded position number');
      Object.assign(row, { [key]: value });
      offset += 8;
    }
    const flags = raw.readUInt16LE(offset);
    offset += 2;
    booleanKeys.forEach((key, flag) => {
      row[key] = (flags & (1 << flag)) !== 0;
    });
    for (const key of stringKeys) {
      const stringIndex = raw.readUInt32LE(offset);
      offset += 4;
      if (stringIndex !== nullString && stringIndex >= strings.length) throw new Error('Invalid position string index');
      Object.assign(row, { [key]: stringIndex === nullString ? null : strings[stringIndex] });
    }
    firstTick = Math.min(firstTick, row.tick);
    lastTick = Math.max(lastTick, row.tick);
    rows.push(row);
  }
  if (firstTick !== block.first_tick || lastTick !== block.last_tick) throw new Error('Invalid position tick bounds');
  return rows;
}
