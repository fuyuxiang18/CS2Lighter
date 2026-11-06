import { describe, expect, it } from 'vite-plus/test';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';
import type { PlayerPositionRow } from './player-position-table';
import { decodePositionBlock, encodePositionBlock, positionBlockMaximumRows } from './position-block-codec';
import { positionFromCsv } from './position-csv';
import { playerPositionRowToPlayerPosition } from './player-position-row-to-player-position';

function position(index = 0): PlayerPositionRow {
  return {
    id: index + 1,
    match_checksum: 'synthetic',
    round_number: 2,
    player_steam_id: '76561198000000000',
    player_name: '玩家, "测试" 🦕',
    frame: 100 + index,
    tick: 64 + Math.floor(index / 2),
    x: -1200.123456789 + index / 16,
    y: Number.MIN_VALUE,
    z: -0,
    yaw: 179.999999,
    flash_duration_remaining: 0.125,
    side: TeamNumber.CT,
    health: 72,
    money: 12450,
    armor: 66,
    is_alive: true,
    has_helmet: true,
    has_bomb: (index & 1) !== 0,
    has_defuse_kit: (index & 2) !== 0,
    is_ducking: (index & 4) !== 0,
    is_airborne: (index & 8) !== 0,
    is_scoping: (index & 16) !== 0,
    is_defusing: (index & 32) !== 0,
    is_planting: (index & 64) !== 0,
    is_grabbing_hostage: (index & 128) !== 0,
    active_weapon_name: WeaponName.M4A4,
    equipments: 'M4A4,Knife',
    grenades: '',
    pistols: null,
    smgs: null,
    rifles: 'M4A4',
    heavy: null,
  };
}

describe('lossless position blocks', () => {
  it('preserves Float64 precision, signed zero, nullable inventories, Unicode, repeated ticks and large IDs', async () => {
    const first = position();
    const second = {
      ...position(1),
      id: '9223372036854775807',
      is_ducking: true,
      has_helmet: false,
      player_name: 'Changed name',
    };
    const block = await encodePositionBlock([first, second]);
    expect(await decodePositionBlock(block)).toEqual([first, second]);
    expect(block.first_tick).toBe(64);
    expect(block.last_tick).toBe(64);
    const [decoded] = await decodePositionBlock(block);
    expect(Object.is(decoded.z, -0)).toBe(true);
  });

  it('compresses repeated per-tick state without throwing away observations', async () => {
    const rows = Array.from({ length: positionBlockMaximumRows }, (_, index) => position(index));
    const block = await encodePositionBlock(rows);
    expect(block.payload.length).toBeLessThan(Buffer.byteLength(JSON.stringify(rows)) / 10);
    expect(await decodePositionBlock(block)).toEqual(rows);
  });

  it('rejects damage, invalid bounds, unsupported size and mixed player/round blocks', async () => {
    const block = await encodePositionBlock([position()]);
    await expect(decodePositionBlock({ ...block, payload: Buffer.from('damaged') })).rejects.toThrow('integrity');
    await expect(decodePositionBlock({ ...block, first_tick: 0 })).rejects.toThrow('tick bounds');
    await expect(encodePositionBlock([])).rejects.toThrow('row count');
    await expect(
      encodePositionBlock(Array.from({ length: positionBlockMaximumRows + 1 }, () => position())),
    ).rejects.toThrow('row count');
    await expect(encodePositionBlock([position(), { ...position(), round_number: 3 }])).rejects.toThrow('crosses');
    await expect(encodePositionBlock([position(), { ...position(), player_steam_id: '0' }])).rejects.toThrow('crosses');
  });

  it('reads the real analyzer column contract, including 0/1 booleans and nullable equipment', () => {
    const csv = [
      '28',
      '1',
      '1',
      '-1400.283203',
      '874.819336',
      '1614.031250',
      '-90.000000',
      '0.000000',
      '3',
      '800',
      '100',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      'USP-S',
      'Knife',
      '',
      'USP-S',
      '',
      '',
      '',
      '76561198000000000',
      'Synthetic',
      '1',
      'synthetic',
    ];
    const row = positionFromCsv(csv, 3);
    expect(row).toMatchObject({
      id: 3,
      is_alive: true,
      is_ducking: false,
      x: -1400.283203,
      grenades: null,
      player_steam_id: '76561198000000000',
    });
    expect(playerPositionRowToPlayerPosition(row).isDucking).toBe(false);
    expect(() => positionFromCsv([...csv.slice(0, 2), 'yes', ...csv.slice(3)], 3)).toThrow('boolean');
    expect(() => positionFromCsv(['', ...csv.slice(1)], 3)).toThrow('number');
    expect(() => positionFromCsv(csv.slice(1), 3)).toThrow('columns');
  });

  it('rejects unsupported codecs and limits expansion even when a damaged payload has a matching hash', async () => {
    const block = await encodePositionBlock([position()]);
    const raw = inflateRawSync(block.payload);
    raw.write('CSP9', 0);
    const unsupported = deflateRawSync(raw);
    await expect(
      decodePositionBlock({
        ...block,
        payload: unsupported,
        payload_sha256: createHash('sha256').update(unsupported).digest('hex'),
      }),
    ).rejects.toThrow('Unsupported');
    const oversized = deflateRawSync(Buffer.alloc(4 * 1024 * 1024 + 1));
    await expect(
      decodePositionBlock({
        ...block,
        payload: oversized,
        payload_sha256: createHash('sha256').update(oversized).digest('hex'),
      }),
    ).rejects.toThrow();
  });
});
