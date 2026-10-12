import { WEAPON_ACCURACY_14190 } from './weapon-accuracy-data';
import { getEvidenceWeaponName } from './evidence-weapon-name';
import type { EvidencePlayer, EvidenceFrame, EvidenceShot } from './evidence-protocol';
import { evidenceNumber } from './evidence-protocol';
import type { DeathRiskWeaponState } from 'csdm/common/types/death-risk';

export type WeaponAccuracyProfile = {
  item: number;
  name: string;
  source: string;
  cycle: number;
  crouch: number;
  stand: number;
  spread: number;
  move: number;
  fire: number;
  land: number;
  recoveryStand: number;
  recoveryCrouch: number;
  recoveryStandFinal: number;
  recoveryCrouchFinal: number;
  fullAuto: boolean;
  bullets: number;
  burst: boolean;
};

function number(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Numeric facts from Valve's compiled resource, never shared speed or burst thresholds. */
export function getWeaponAccuracyProfile(
  patch: number | null,
  item: number,
  mode: number,
): WeaponAccuracyProfile | null {
  if (patch !== 14190 || (mode !== 0 && mode !== 1)) return null;
  const data = WEAPON_ACCURACY_14190.find((p) => p.item === item);
  if (!data) return null;
  const pair = (v: number | readonly number[]) => (typeof v === 'number' ? v : v[mode]);
  return {
    ...data,
    source: `valve-weapons-vdata:14190:b6efe34a:${item}:${mode}`,
    cycle: pair(data.cycle),
    crouch: pair(data.crouch),
    stand: pair(data.stand),
    spread: pair(data.spread),
    move: pair(data.move),
    fire: pair(data.fire),
    land: pair(data.land),
  };
}

/** Keeps the controller clock separate from demo ticks and the decoded GameTick_t clock. */
export function decodeRiskWeaponState(
  player: EvidencePlayer,
  frame: EvidenceFrame,
  tickrate: number,
): DeathRiskWeaponState | null {
  const weapon = player.activeWeapon;
  if (!weapon) return null;
  const item = evidenceNumber(weapon.fields['m_AttributeManager.m_Item.m_iItemDefinitionIndex']);
  if (item === null || !Number.isSafeInteger(item)) return null;
  const profile = WEAPON_ACCURACY_14190.find((p) => p.item === item);
  const kind = profile
    ? 'gun'
    : item >= 43 && item <= 48
      ? 'grenade'
      : item === 49
        ? 'bomb'
        : [42, 59].includes(item) || (item >= 500 && item < 600)
          ? 'knife'
          : 'other';
  const clip = evidenceNumber(weapon.fields['m_iClip1']);
  const magazine = clip !== null && Number.isInteger(clip) && clip >= 0 ? clip : null;
  const reloadField = weapon.fields['m_bInReload'];
  const reloading = reloadField?.present === true && typeof reloadField.value === 'boolean' ? reloadField.value : null;
  let ready: boolean | null = null;
  let nextReadyTick: number | null = null;
  if (kind === 'gun' && (magazine === 0 || reloading === true)) ready = false;
  const base = evidenceNumber(player.fields['controller.m_nTickBase']);
  const ownerAttack = evidenceNumber(player.fields['m_pWeaponServices.m_flNextAttack']);
  const next = evidenceNumber(weapon.fields['decoded.m_nNextPrimaryAttackTick']);
  const ratio = evidenceNumber(weapon.fields['m_flNextPrimaryAttackTickRatio']);
  // Unknown tick-base offsets are not guessed. Sentinel attack ticks are not timestamps.
  if (
    kind === 'gun' &&
    tickrate > 0 &&
    Number.isFinite(tickrate) &&
    base !== null &&
    base === frame.serverTick &&
    ownerAttack !== null &&
    ownerAttack >= 0
  ) {
    const ownerRemaining = ownerAttack * tickrate - base;
    if (ownerRemaining > 0) {
      ready = false;
      nextReadyTick = frame.tick + Math.ceil(ownerRemaining);
    }
    if (next !== null && Number.isSafeInteger(next) && next >= 0 && ratio !== null && ratio >= 0 && ratio < 1) {
      const remaining = Math.max(ownerRemaining, next + ratio - base);
      nextReadyTick = frame.tick + Math.max(0, Math.ceil(remaining));
      if (remaining > 0) ready = false;
      else if (
        reloading === false &&
        magazine !== null &&
        magazine > 0 &&
        item !== 64 &&
        player.lifeState === 0 &&
        (player.health ?? 0) > 0
      )
        ready = true;
    }
  }
  if (magazine === 0 || reloading === true) nextReadyTick = null;
  return {
    entityId: weapon.id,
    name: getEvidenceWeaponName(item) ?? weapon.className,
    kind,
    magazine,
    reloading,
    ready,
    nextReadyTick,
  };
}

/** The broadcast encloses a shot in server ticks; it does not by itself supply a sub-tick time. */
export function shotServerInterval(shot: EvidenceShot): { first: number; last: number } | null {
  const tick = number(shot.raw.tick);
  const serverTick = shot.serverTick;
  if (
    tick === null ||
    serverTick === null ||
    !Number.isSafeInteger(tick) ||
    !Number.isSafeInteger(serverTick) ||
    tick < 0 ||
    serverTick < tick ||
    serverTick - tick > 1
  )
    return null;
  return { first: tick - 1, last: serverTick };
}

export function spreadHalfAngleDegrees(inaccuracy: number, spread: number): number {
  return (Math.atan(inaccuracy + spread) * 180) / Math.PI;
}
