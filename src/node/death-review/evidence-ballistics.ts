import type { EvidenceShot } from './evidence-protocol';
import { shotServerInterval } from './weapon-accuracy';

/** A separately transmitted game event; absent values remain absent rather than protobuf defaults. */
export type EvidenceBulletDamage = {
  type: 'bullet-damage';
  tick: number;
  frame: number;
  serverTick: number | null;
  attackerEntityId: string | null;
  attackerSteamId: string | null;
  victimEntityId: string | null;
  victimSteamId: string | null;
  weaponEntityId: string | null;
  itemDefinitionIndex: number | null;
  raw: Record<string, unknown>;
};

export type ShotAccuracyComponents = {
  source: 'fire-bullets-extra' | 'bullet-damage';
  movement: number;
  airborne: number;
  inAir: boolean;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameFloat(a: unknown, b: unknown): boolean {
  return finite(a) && finite(b) && Math.fround(a) === Math.fround(b);
}

function extra(shot: EvidenceShot): Record<string, unknown> {
  const value = shot.raw.extra;
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function components(
  movement: unknown,
  airborne: unknown,
  inAir: unknown,
  total: unknown,
): { movement: number; airborne: number; inAir: boolean } | null {
  if (
    !finite(movement) ||
    !finite(airborne) ||
    !finite(total) ||
    typeof inAir !== 'boolean' ||
    movement < 0 ||
    airborne < 0 ||
    total < 0 ||
    movement > total ||
    airborne > total ||
    movement + airborne > total + Number.EPSILON
  )
    return null;
  return { movement, airborne, inAir };
}

/**
 * Do not join a damage event merely because its total or demo tick matches.
 * The shooter pawn, weapon lifecycle, sole confirmed victim, both clocks and
 * measured recoil/total must agree. Multiple pellets, penetrations or duplicate
 * candidate records stay unresolved.
 */
export function resolveShotAccuracyComponents(input: {
  shot: EvidenceShot;
  shots: readonly EvidenceShot[];
  targetIds: readonly string[];
  bulletDamages: readonly EvidenceBulletDamage[];
}): ShotAccuracyComponents | null {
  const { shot } = input;
  const data = extra(shot);
  const direct = components(data.inaccuracy_move, data.inaccuracy_air, shot.raw.player_inair, shot.raw.inaccuracy);
  const candidates = input.bulletDamages.filter(
    (event) =>
      event.tick === shot.tick &&
      event.attackerEntityId === shot.playerEntityId &&
      event.attackerSteamId === shot.steamId,
  );
  if (candidates.length === 0) return direct ? { source: 'fire-bullets-extra', ...direct } : null;
  // Even a conflicting duplicate must not be silently discarded in favor of a convenient record.
  if (candidates.length !== 1 || input.targetIds.length !== 1) return null;
  const event = candidates[0];
  const interval = shotServerInterval(shot);
  const handle = shot.raw.weapon_id;
  const attackTick = event.raw.attack_tick_count;
  const attackFraction = event.raw.attack_tick_frac;
  const renderTick = event.raw.render_tick_count;
  const renderFraction = event.raw.render_tick_frac;
  if (
    !shot.playerEntityId ||
    !shot.steamId ||
    !event.victimEntityId ||
    event.victimEntityId === event.attackerEntityId ||
    event.victimSteamId === event.attackerSteamId ||
    event.victimSteamId !== input.targetIds[0] ||
    event.serverTick !== shot.serverTick ||
    !interval ||
    !finite(handle) ||
    !Number.isSafeInteger(handle) ||
    handle < 0 ||
    handle > 0xffffffff ||
    event.weaponEntityId !== `${handle & 0x3fff}:${Math.floor(handle / 16384)}` ||
    event.itemDefinitionIndex !== shot.raw.item_def_index ||
    !finite(event.raw.distance) ||
    event.raw.distance <= 0 ||
    !sameFloat(event.raw.inaccuracy_total, shot.raw.inaccuracy) ||
    !sameFloat(event.raw.recoil_index, shot.raw.recoil_index) ||
    !finite(attackTick) ||
    !Number.isSafeInteger(attackTick) ||
    attackTick < interval.first ||
    attackTick > interval.last ||
    !finite(attackFraction) ||
    attackFraction < 0 ||
    attackFraction >= 1 ||
    !finite(renderTick) ||
    !Number.isSafeInteger(renderTick) ||
    renderTick < 0 ||
    renderTick > interval.last ||
    !finite(renderFraction) ||
    renderFraction < 0 ||
    renderFraction >= 1 ||
    input.shots.filter(
      (other) =>
        other.tick === shot.tick && other.steamId === shot.steamId && other.playerEntityId === shot.playerEntityId,
    ).length !== 1
  )
    return null;
  const joined = components(
    event.raw.inaccuracy_move,
    event.raw.inaccuracy_air,
    event.raw.in_air,
    event.raw.inaccuracy_total,
  );
  if (!joined) return null;
  for (const name of [
    'attack_tick_count',
    'attack_tick_frac',
    'render_tick_count',
    'render_tick_frac',
    'inaccuracy_move',
    'inaccuracy_air',
  ])
    if (data[name] !== null && data[name] !== undefined && !sameFloat(data[name], event.raw[name])) return null;
  if (typeof shot.raw.player_inair === 'boolean' && shot.raw.player_inair !== joined.inAir) return null;
  return { source: direct ? 'fire-bullets-extra' : 'bullet-damage', ...joined };
}
