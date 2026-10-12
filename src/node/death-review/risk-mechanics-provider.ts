import type { DeathRiskAimSample, DeathRiskPrecisionSample, DeathRiskShot } from 'csdm/common/types/death-risk';
import type { DeathMechanicsMeasurement, DeathMechanicsReason } from 'csdm/common/types/death-mechanics';
import type { EvidenceEnd, EvidenceFrame, EvidenceHeader, EvidencePlayer, EvidenceShot } from './evidence-protocol';
import { evidenceNumber } from './evidence-protocol';
import { getEvidenceWeaponName } from './evidence-weapon-name';
import {
  getWeaponAccuracyProfile,
  shotServerInterval,
  spreadHalfAngleDegrees,
  type WeaponAccuracyProfile,
} from './weapon-accuracy';

/** A caller must join the damage exchange uniquely. A nearby player is not a confirmed target. */
export type RiskMechanicsContact = {
  shotTick: number;
  targetId: string;
  distance: number;
  source: string;
};

/** Optional exact target envelope; collision movement hulls do not satisfy this contract. */
export type RiskMechanicsAimProof = {
  shotTick: number;
  targetId: string;
  burstId: string;
  source: string;
  fullBodyAndClockVerified: boolean;
  targetAssociationVerified: boolean;
  mapDynamicSmokeClear: boolean;
  relativePitch: number;
  relativeYaw: number;
  bodyPitchMin: number;
  bodyPitchMax: number;
  bodyYawMin: number;
  bodyYawMax: number;
};

type State = {
  frame: EvidenceFrame;
  player: EvidencePlayer;
  penalty: number;
  duck: number;
  scoped: boolean;
  ground: boolean;
  speed: number;
  velocityZ: number;
  turningInaccuracy: number | null;
};
export type RiskMechanicsResult = {
  shots: DeathRiskShot[];
  precision: DeathRiskPrecisionSample[];
  aim: DeathRiskAimSample[];
  measurements: DeathMechanicsMeasurement[];
  coverage: { precision: boolean; aim: boolean };
  reasons: DeathMechanicsReason[];
};

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
const tolerance = 0.000001; // conservative float-serialization comparison, not a gameplay threshold
const accuracyFields = ['m_bIsScoped', 'm_fFlags', 'm_MoveType', 'm_pMovementServices.m_flDuckAmount'];

function state(frame: EvidenceFrame, raw: EvidenceShot): State | null {
  const players = frame.players.filter((p) => p.id === raw.playerEntityId && p.steamId === raw.steamId);
  if (players.length !== 1) return null;
  const player = players[0],
    weapon = player.activeWeapon;
  const h = finite(raw.raw.weapon_id);
  if (
    !weapon ||
    h === null ||
    !Number.isSafeInteger(h) ||
    h < 0 ||
    h > 0xffffffff ||
    weapon.id !== `${h & 0x3fff}:${Math.floor(h / 16384)}` ||
    !player.velocity ||
    player.lifeState !== 0 ||
    (player.health ?? 0) <= 0 ||
    accuracyFields.some((k) => player.fields[k]?.present !== true)
  )
    return null;
  const penalty = evidenceNumber(weapon.fields['m_fAccuracyPenalty']);
  const duck = evidenceNumber(player.fields['m_pMovementServices.m_flDuckAmount']);
  const flags = evidenceNumber(player.fields['m_fFlags']);
  const scoped = player.fields['m_bIsScoped'].value;
  const reloading = weapon.fields['m_bInReload'];
  if (
    evidenceNumber(weapon.fields['m_weaponMode']) === null ||
    evidenceNumber(weapon.fields['m_weaponMode']) !== finite(raw.raw.mode) ||
    penalty === null ||
    penalty < 0 ||
    duck === null ||
    ![0, 1].includes(duck) ||
    flags === null ||
    !Number.isInteger(flags) ||
    typeof scoped !== 'boolean' ||
    evidenceNumber(player.fields['m_MoveType']) !== 2 ||
    reloading?.present !== true ||
    reloading.value !== false
  )
    return null;
  return {
    frame,
    player,
    penalty,
    duck,
    scoped,
    ground: (flags & 1) === 1,
    speed: Math.hypot(player.velocity[0], player.velocity[1]),
    velocityZ: player.velocity[2],
    turningInaccuracy: evidenceNumber(weapon.fields['m_flTurningInaccuracy']),
  };
}

function stableStates(states: State[]): boolean {
  return (
    states.length > 0 &&
    states.every(
      (s) =>
        s.duck === states[0].duck &&
        s.scoped === states[0].scoped &&
        s.player.health === states[0].player.health &&
        s.player.team === states[0].player.team,
    )
  );
}

function profileAgrees(profile: WeaponAccuracyProfile, raw: EvidenceShot): boolean {
  const spread = finite(raw.raw.spread);
  return (
    profile.bullets === 1 &&
    !profile.burst &&
    ![9, 11, 38, 40, 64].includes(profile.item) &&
    spread !== null &&
    Math.abs(spread - profile.spread) <= tolerance
  );
}

/**
 * Uses measured shot inaccuracy and the weapon's observed accuracy-penalty trajectory.
 * Never replays an assumed deceleration/recovery formula. Attribution requires a
 * clean measured baseline and a complete, unchanged state interval. Ambiguous
 * airborne/stance/scope/reload/multiple-shot intervals remain unavailable.
 */
export function buildRiskMechanicsEvidence(input: {
  header: EvidenceHeader;
  frames: readonly EvidenceFrame[];
  shots: readonly EvidenceShot[];
  end: EvidenceEnd;
  subjectId: string;
  contacts?: readonly RiskMechanicsContact[];
  aimProofs?: readonly RiskMechanicsAimProof[];
}): RiskMechanicsResult {
  const result: RiskMechanicsResult = {
    shots: [],
    precision: [],
    aim: [],
    measurements: [],
    coverage: { precision: false, aim: false },
    reasons: [],
  };
  const complete =
    input.end.status === 'ok' &&
    input.end.missingTicks.length === 0 &&
    input.end.emittedTicks === input.frames.length &&
    input.end.shots === input.shots.length &&
    input.frames.length === input.header.requestedTicks;
  const byServerTick = new Map<number, EvidenceFrame>();
  const duplicateServerTicks = new Set<number>();
  for (const frame of input.frames)
    if (frame.serverTick !== null) {
      if (byServerTick.has(frame.serverTick)) duplicateServerTicks.add(frame.serverTick);
      byServerTick.set(frame.serverTick, frame);
    }
  const raws = input.shots
    .filter((s) => s.steamId === input.subjectId)
    .toSorted((a, b) => a.tick - b.tick || a.frame - b.frame);
  for (let index = 0; index < raws.length; index++) {
    const raw = raws[index],
      item = finite(raw.raw.item_def_index),
      mode = finite(raw.raw.mode),
      inaccuracy = finite(raw.raw.inaccuracy),
      spread = finite(raw.raw.spread),
      recoil = finite(raw.raw.recoil_index);
    const profile = item === null || mode === null ? null : getWeaponAccuracyProfile(input.header.patch, item, mode);
    const clock = shotServerInterval(raw),
      id = `mechanics:${raw.tick}:${raw.frame}:${index}`;
    const m: DeathMechanicsMeasurement = {
      shotId: id,
      tick: raw.tick,
      weaponName: (item === null ? undefined : getEvidenceWeaponName(item)) ?? String(item ?? 'unknown'),
      profileSource: profile?.source ?? null,
      inaccuracy,
      spread,
      stationaryInaccuracy: null,
      speed: null,
      firstServerTick: clock?.first ?? null,
      lastServerTick: clock?.last ?? null,
      component: null,
      reasons: [],
    };
    result.measurements.push(m);
    const interval: State[] = [];
    if (clock)
      for (let t = clock.first; t <= clock.last; t++) {
        const f = byServerTick.get(t),
          s = f && !duplicateServerTicks.has(t) ? state(f, raw) : null;
        if (!s) break;
        interval.push(s);
      }
    if (
      !complete ||
      !clock ||
      interval.length !== clock.last - clock.first + 1 ||
      !stableStates(interval) ||
      raws.filter((s) => s.tick === raw.tick).length !== 1
    ) {
      m.reasons.push('shot-state-incomplete');
      continue;
    }
    const current = interval.at(-1)!;
    result.shots.push({
      id,
      tick: raw.tick,
      actorId: input.subjectId,
      weaponEntityId: current.player.activeWeapon!.id,
      weaponName: m.weaponName,
    });
    m.speed = Math.max(...interval.map((s) => s.speed));
    if (!profile || !profileAgrees(profile, raw)) {
      m.reasons.push('weapon-profile-unverified');
      continue;
    }
    if (inaccuracy === null || inaccuracy < 0 || spread === null || recoil === null || recoil < 0) {
      m.reasons.push('shot-accuracy-missing');
      continue;
    }
    const baseline = current.duck === 1 ? profile.crouch : profile.stand;
    m.stationaryInaccuracy = baseline;
    const history: State[] = [];
    // Walk the contiguous server clock backwards. Stop at missing or changed weapon state.
    for (let t = clock.first; t >= Math.min(...byServerTick.keys()); t--) {
      const f = byServerTick.get(t),
        s = f && !duplicateServerTicks.has(t) ? state(f, raw) : null;
      if (!s) break;
      history.unshift(s);
      if (s.ground && s.penalty <= baseline + tolerance && s.speed === 0 && s.velocityZ === 0) break;
    }
    const anchor = history[0];
    const sinceAnchor = [...history, ...interval.slice(1)];
    const cleanAnchor =
      anchor &&
      anchor.ground &&
      anchor.penalty <= baseline + tolerance &&
      anchor.speed === 0 &&
      anchor.velocityZ === 0 &&
      stableStates(sinceAnchor);
    const previous = raws[index - 1];
    const priorShots = raws.filter((s) => s.tick >= (anchor?.frame.tick ?? raw.tick) && s.tick < raw.tick);
    let kind: DeathRiskPrecisionSample['kind'] | null = null;
    let conservativeBaseline = baseline;
    let landingTick: number | undefined;
    const direct = record(raw.raw.extra),
      directMove = finite(direct?.inaccuracy_move),
      directAir = finite(direct?.inaccuracy_air);
    const noTurning = sinceAnchor.every((s) => s.turningInaccuracy === 0);
    if (cleanAnchor && interval.every((s) => s.ground) && inaccuracy > baseline + tolerance) {
      if (
        recoil === 0 &&
        priorShots.length === 0 &&
        directMove !== null &&
        directMove > tolerance &&
        directMove <= inaccuracy &&
        directAir === 0
      ) {
        kind = 'movement';
        conservativeBaseline = inaccuracy - directMove;
      }
      // For a fresh shot, even the post-shot penalty is used as the upper bound
      // of non-moving inaccuracy. This deliberately misses marginal movement.
      const penaltyUpper = Math.max(...interval.map((s) => s.penalty));
      if (
        !kind &&
        noTurning &&
        recoil === 0 &&
        priorShots.length === 0 &&
        sinceAnchor.every((s) => s.ground && s.velocityZ === 0) &&
        interval.every((s) => s.speed > 0) &&
        inaccuracy > penaltyUpper + tolerance
      ) {
        if (directMove === null || (directMove > tolerance && directAir === 0)) {
          kind = 'movement';
          conservativeBaseline = penaltyUpper;
        }
      }
      // Recovery is identified from the measured elevated, decaying penalty
      // after a known previous shot while the player remains motionless.
      if (
        !kind &&
        noTurning &&
        previous &&
        priorShots.length > 0 &&
        recoil > 0 &&
        finite(previous.raw.recoil_index) !== null &&
        recoil < (previous.raw.recoil_index as number) + 1 - tolerance &&
        raw.tick - previous.tick > Math.ceil(profile.cycle * input.header.tickRate) + 1 &&
        sinceAnchor.every((s) => s.ground && s.speed === 0 && s.velocityZ === 0)
      ) {
        const decay = history.filter((s) => s.frame.tick > previous.tick);
        if (
          decay.length >= 2 &&
          decay.every((s, i) => i === 0 || s.penalty <= decay[i - 1].penalty + tolerance) &&
          decay.at(-1)!.penalty > baseline + tolerance
        )
          kind = 'recovery';
      }
      // A landing attribution requires the entire jump since a clean baseline,
      // no firing and no horizontal movement. Airborne shots never qualify.
      if (!kind && noTurning && recoil === 0 && priorShots.length === 0 && sinceAnchor.every((s) => s.speed === 0)) {
        const transitions = sinceAnchor.filter((s, i) => i > 0 && s.ground && !sinceAnchor[i - 1].ground);
        if (
          transitions.length === 1 &&
          history.some((s) => !s.ground) &&
          interval.every((s) => s.velocityZ === 0) &&
          history.at(-1)!.penalty > baseline + tolerance
        ) {
          kind = 'landing';
          landingTick = transitions[0].frame.tick;
        }
      }
    }
    m.component = kind;
    if (!kind) {
      m.reasons.push(
        inaccuracy <= baseline + tolerance ? 'no-material-accuracy-loss' : 'accuracy-component-unverified',
      );
      continue;
    }
    const contacts = (input.contacts ?? []).filter(
      (c) => c.shotTick === raw.tick && c.source && c.targetId && Number.isFinite(c.distance) && c.distance > 0,
    );
    if (contacts.length !== 1) {
      m.reasons.push('target-exchange-unverified');
      continue;
    }
    const contact = contacts[0];
    let stableAfterTick: number | null = null;
    for (const f of input.frames.filter((f) => f.tick > raw.tick)) {
      const s = state(f, raw);
      if (
        !s ||
        s.duck !== current.duck ||
        s.scoped !== current.scoped ||
        raws.some((shot) => shot.tick > raw.tick && shot.tick <= f.tick)
      )
        break;
      if (s.ground && s.speed === 0 && s.penalty <= baseline + tolerance) {
        stableAfterTick = f.tick;
        break;
      }
    }
    result.precision.push({
      shotId: id,
      kind,
      profileSource: `${profile.source};measured-penalty-envelope;${contact.source}`,
      profileVerified: true,
      componentVerified: true,
      measurementResolutionDegrees: spreadHalfAngleDegrees(tolerance, 0),
      segmentFirstShot: true,
      baselineHalfAngleDegrees: spreadHalfAngleDegrees(conservativeBaseline, spread),
      actualHalfAngleDegrees: spreadHalfAngleDegrees(inaccuracy, spread),
      targetHalfAngleDegrees: null,
      targetId: contact.targetId,
      targetGeometryVerified: false,
      targetAssociationVerified: true,
      distance: contact.distance,
      stableAfterTick,
      ...(kind === 'movement' ? { movementSpeed: m.speed! } : {}),
      ...(landingTick !== undefined ? { landingTick } : {}),
      ...(kind === 'recovery' && previous ? { precedingShotTick: previous.tick } : {}),
    });
  }
  // R4 accepts target-relative data only from a certified geometry/clock producer.
  for (const proof of input.aimProofs ?? []) {
    const matches = result.shots.filter((s) => s.tick === proof.shotTick),
      raw = raws.filter((s) => s.tick === proof.shotTick);
    if (
      matches.length !== 1 ||
      raw.length !== 1 ||
      !proof.fullBodyAndClockVerified ||
      !proof.targetAssociationVerified ||
      !proof.mapDynamicSmokeClear ||
      !proof.source
    )
      continue;
    const profile = getWeaponAccuracyProfile(
      input.header.patch,
      Number(raw[0].raw.item_def_index),
      Number(raw[0].raw.mode),
    );
    if (!profile || !profile.fullAuto || profile.bullets !== 1 || profile.burst) continue;
    result.aim.push({
      ...proof,
      shotId: matches[0].id,
      verified: true,
      maximumGapTicks: Math.ceil(profile.cycle * input.header.tickRate) + 1,
    });
  }
  result.coverage.precision =
    complete &&
    result.measurements.length > 0 &&
    result.measurements.every(
      (m) => m.reasons.length === 0 || m.reasons.every((r) => r === 'no-material-accuracy-loss'),
    );
  result.coverage.aim = complete && result.shots.length > 0 && result.aim.length === result.shots.length;
  result.reasons = [...new Set(result.measurements.flatMap((m) => m.reasons))];
  if (!result.coverage.aim) result.reasons.push('target-body-clock-unverified');
  return result;
}
