import type { PlayerPositionRow } from './player-position-table';
import type { TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';

function number(value: string, integer = true) {
  const result = Number(value);
  if (value.trim() === '' || !Number.isFinite(result) || (integer && !Number.isSafeInteger(result)))
    throw new Error('Invalid position CSV number');
  return result;
}

function boolean(value: string) {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new Error('Invalid position CSV boolean');
}

/** Fixed analyzer 1.11 CSV contract; keep direct assignments for millions of observations per match. */
export function positionFromCsv(values: string[], ordinal: number): PlayerPositionRow {
  if (values.length !== 32) throw new Error('Unexpected position CSV columns');
  return {
    id: ordinal,
    frame: number(values[0]),
    tick: number(values[1]),
    is_alive: boolean(values[2]),
    x: number(values[3], false),
    y: number(values[4], false),
    z: number(values[5], false),
    yaw: number(values[6], false),
    flash_duration_remaining: number(values[7], false),
    side: number(values[8]) as TeamNumber,
    money: number(values[9]),
    health: number(values[10]),
    armor: number(values[11]),
    has_helmet: boolean(values[12]),
    has_bomb: boolean(values[13]),
    has_defuse_kit: boolean(values[14]),
    is_ducking: boolean(values[15]),
    is_airborne: boolean(values[16]),
    is_scoping: boolean(values[17]),
    is_defusing: boolean(values[18]),
    is_planting: boolean(values[19]),
    is_grabbing_hostage: boolean(values[20]),
    active_weapon_name: (values[21] || null) as WeaponName,
    equipments: values[22] || null,
    grenades: values[23] || null,
    pistols: values[24] || null,
    smgs: values[25] || null,
    rifles: values[26] || null,
    heavy: values[27] || null,
    player_steam_id: values[28],
    player_name: values[29],
    round_number: number(values[30]),
    match_checksum: values[31],
  };
}
