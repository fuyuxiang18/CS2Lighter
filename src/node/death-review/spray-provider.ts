import { getEvidenceWeaponName } from './evidence-weapon-name';
import type { DeathMatchInput } from './build-death-review';
import type { EvidenceEnd, EvidenceFrame, EvidenceHeader, EvidenceShot } from './evidence-protocol';
import {
  buildSprayEvidence,
  normalizeSprayYaw,
  type SprayFireSample,
  type SprayTargetFrame,
  type SprayEvidenceInput,
} from './spray-evidence';

export type SprayRawTrajectoryPoint = {
  id: string;
  tick: number;
  frame: number;
  serverTick: number | null;
  steamId: string | null;
  playerEntityId: string | null;
  playerHandle: number | null;
  direction: { pitch: number; yaw: number } | null;
  origin: { x: number; y: number; z: number } | null;
  recoilIndex: number | null;
  itemDefinitionIndex: number | null;
  identityVerified: boolean;
};

/** No implementation of this provider is implied by its type. The caller must verify all resources. */
type SprayGeometryResult =
  | {
      status: 'verified';
      frame: SprayTargetFrame;
      provenance: {
        providerVersion: string;
        mapFingerprint: string;
        geometry: 'verified-map-dynamic-and-smoke';
        bodyBounds: 'verified-full-body-conservative';
        clock: 'decoded-server-ticks';
      };
    }
  | { status: 'unavailable'; reasons: string[] };

export type SprayGeometryProvider = (request: {
  shot: SprayFireSample;
  rawShot: EvidenceShot;
  targetSteamId: string;
  frames: readonly EvidenceFrame[];
  maximumUnlagSeconds: number | undefined;
}) => SprayGeometryResult | Promise<SprayGeometryResult>;

export type SprayProviderInput = {
  header: EvidenceHeader;
  frames: EvidenceFrame[];
  shots: EvidenceShot[];
  end: EvidenceEnd;
  match: Pick<
    DeathMatchInput,
    'checksum' | 'steamId' | 'tickrate' | 'rounds' | 'shots' | 'damages' | 'kills' | 'blinds' | 'shotsComplete'
  >;
  /** A verified upper bound from matching server-version configuration/schema, never a guessed default. */
  maximumUnlagSeconds?: number;
  geometryProvider?: SprayGeometryProvider;
};

export type SprayProviderResult = {
  status: 'blocked' | 'partial' | 'evaluated';
  reasons: string[];
  rawTrajectory: SprayRawTrajectoryPoint[];
  evidence: ReturnType<typeof buildSprayEvidence>;
  coverage: {
    rawShots: number;
    identityVerified: number;
    databaseMatched: number;
    confirmedDamage: number;
    evaluatedShots: number;
  };
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function rawVector(value: unknown): { x: number; y: number; z: number } | null {
  const item = record(value);
  if (!item) return null;
  const x = finiteNumber(item.x),
    y = finiteNumber(item.y),
    z = finiteNumber(item.z);
  return x === null || y === null || z === null ? null : { x, y, z };
}
function rawDirection(value: unknown): { pitch: number; yaw: number } | null {
  const item = record(value);
  if (!item) return null;
  const pitch = finiteNumber(item.x),
    yaw = finiteNumber(item.y);
  return pitch === null || yaw === null || Math.abs(pitch) > 90 || Math.abs(yaw) > 3600
    ? null
    : { pitch, yaw: normalizeSprayYaw(yaw) };
}
function sameTickFrame(a: { tick: number; frame: number }, b: { tick: number; frame: number }): boolean {
  return a.tick === b.tick && a.frame === b.frame;
}
function positiveIdentifier(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^\d{17}$/.test(id) && id !== '00000000000000000';
}

export async function buildSprayProviderEvidence(input: SprayProviderInput): Promise<SprayProviderResult> {
  const reasons = new Set<string>();
  const rawTrajectory: SprayRawTrajectoryPoint[] = [];
  const core: SprayEvidenceInput = {
    tickRate: input.header.tickRate,
    maximumUnlagSeconds: input.maximumUnlagSeconds,
    shots: [],
    engagements: [],
    targetFrames: [],
  };
  const rawById = new Map<string, EvidenceShot>();
  const dbById = new Map<string, DeathMatchInput['shots'][number]>();
  const ordinals = new Map<string, number>();
  const complete =
    input.end.status === 'ok' &&
    input.end.missingTicks.length === 0 &&
    input.end.frames === input.frames.length &&
    input.frames.length === new Set(input.frames.map((frame) => frame.tick)).size &&
    input.end.shots === input.shots.length &&
    input.end.emittedTicks === new Set(input.frames.map((f) => f.tick)).size &&
    input.end.emittedTicks === input.header.requestedTicks;
  const clocksAgree =
    Number.isFinite(input.header.tickRate) &&
    input.header.tickRate > 0 &&
    input.header.tickRate === input.match.tickrate;
  if (!complete) reasons.add('extraction-incomplete');
  if (!clocksAgree) reasons.add('tick-rate-mismatch');
  if (!input.match.shotsComplete) reasons.add('database-shots-incomplete');
  if (!input.geometryProvider) reasons.add('geometry-provider-unavailable');
  for (const raw of input.shots) {
    // The extractor resolves this full pawn lifecycle at the actual network message callback.
    const entityId = (raw as EvidenceShot & { playerEntityId?: string | null }).playerEntityId ?? null;
    const weaponHandle = finiteNumber(raw.raw.weapon_id);
    const item = finiteNumber(raw.raw.item_def_index);
    const origin = rawVector(raw.raw.origin);
    const direction = rawDirection(raw.raw.angles);
    const recoil = finiteNumber(raw.raw.recoil_index);
    const identityKey = `${input.match.checksum}:fire:${raw.tick}:${raw.frame}:${raw.playerHandle}:${weaponHandle}`;
    const ordinal = ordinals.get(identityKey) ?? 0;
    ordinals.set(identityKey, ordinal + 1);
    const id = `${identityKey}:${ordinal}`;
    // demoinfocs increments CurrentFrame before FrameDone: the matching snapshot can be +1.
    // Require exactly one same-tick lifecycle; never choose a nearby tick or reused entity index.
    const matchingFrames = input.frames.filter(
      (f) => f.tick === raw.tick && (f.frame === raw.frame || f.frame === raw.frame + 1),
    );
    const players =
      matchingFrames.length === 1
        ? matchingFrames[0].players.filter((p) => p.id === entityId && p.steamId === raw.steamId)
        : [];
    const identityVerified =
      entityId !== null &&
      /^\d+:\d+$/.test(entityId) &&
      positiveIdentifier(raw.steamId) &&
      Number.isSafeInteger(raw.playerHandle) &&
      (raw.playerHandle as number) >= 0 &&
      players.length === 1;
    rawTrajectory.push({
      id,
      tick: raw.tick,
      frame: raw.frame,
      serverTick: raw.serverTick,
      steamId: raw.steamId,
      playerEntityId: entityId,
      playerHandle: raw.playerHandle,
      direction,
      origin,
      recoilIndex: recoil,
      itemDefinitionIndex: item,
      identityVerified,
    });
    if (!identityVerified) reasons.add('player-lifecycle-unverified');
    if (
      raw.steamId !== input.match.steamId ||
      !identityVerified ||
      !origin ||
      !direction ||
      weaponHandle === null ||
      !Number.isSafeInteger(weaponHandle) ||
      item === null ||
      !Number.isSafeInteger(item)
    )
      continue;
    const rounds = input.match.rounds.filter(
      (r) => r.match_checksum === input.match.checksum && r.start_tick <= raw.tick && r.end_tick >= raw.tick,
    );
    if (rounds.length !== 1) {
      reasons.add('round-unverified');
      continue;
    }
    const shot: SprayFireSample = {
      id,
      tick: raw.tick,
      roundNumber: rounds[0].number,
      shooterSteamId: raw.steamId as string,
      weaponEntityId: String(weaponHandle),
      itemDefinitionIndex: item,
      origin,
      angles: direction,
      recoilIndex: recoil,
    };
    if (raw.serverTick !== null && Number.isSafeInteger(raw.serverTick) && raw.serverTick >= 0)
      shot.serverTick = raw.serverTick;
    // No exact attack timestamp is fabricated from demoTick, packet tick, or a stale usercmd.
    const inaccuracy = finiteNumber(raw.raw.inaccuracy),
      spread = finiteNumber(raw.raw.spread);
    if (inaccuracy !== null) shot.inaccuracy = inaccuracy;
    if (spread !== null) shot.spread = spread;
    core.shots.push(shot);
    rawById.set(id, raw);
    const sameRawShots = input.shots.filter((r) => r.steamId === raw.steamId && sameTickFrame(r, raw));
    const dbShots = input.match.shots.filter(
      (s) =>
        s.match_checksum === input.match.checksum &&
        s.player_steam_id === raw.steamId &&
        s.round_number === shot.roundNumber &&
        sameTickFrame(s, raw) &&
        s.weapon_name === getEvidenceWeaponName(item) &&
        !s.is_player_controlling_bot,
    );
    if (sameRawShots.length === 1 && dbShots.length === 1) dbById.set(id, dbShots[0]);
    else reasons.add('shot-event-join-ambiguous');
  }
  const structural = buildSprayEvidence(core);
  let confirmedDamage = 0;
  for (const segment of structural.segments) {
    const confirmations: { shotId: string; targetSteamId: string }[] = [];
    for (const id of segment.shotIds) {
      const db = dbById.get(id);
      if (!db) continue;
      const damage = input.match.damages.filter(
        (d) =>
          d.match_checksum === input.match.checksum &&
          d.round_number === segment.roundNumber &&
          d.attacker_steam_id === segment.shooterSteamId &&
          sameTickFrame(d, db) &&
          d.weapon_unique_id === db.weapon_id &&
          d.weapon_name === db.weapon_name &&
          Number.isFinite(d.health_damage) &&
          d.health_damage > 0 &&
          d.victim_health > 0 &&
          d.attacker_side !== d.victim_side &&
          [2, 3].includes(d.attacker_side) &&
          [2, 3].includes(d.victim_side) &&
          !d.is_attacker_controlling_bot &&
          !d.is_victim_controlling_bot &&
          positiveIdentifier(d.victim_steam_id),
      );
      // Multiple hurt records may be separate bullets/pellets even when they name one target.
      if (damage.length === 1) confirmations.push({ shotId: id, targetSteamId: damage[0].victim_steam_id });
      else if (damage.length > 1) reasons.add('damage-event-join-ambiguous');
    }
    confirmedDamage += confirmations.length;
    const targetIds = new Set(confirmations.map((d) => d.targetSteamId));
    if (targetIds.size !== 1 || !complete || !clocksAgree || !input.match.shotsComplete) continue;
    const targetSteamId = [...targetIds][0];
    const segmentShots = core.shots.filter((s) => segment.shotIds.includes(s.id));
    const startTick = Math.min(...segmentShots.map((s) => s.tick));
    const endTick = Math.max(...segmentShots.map((s) => s.tick));
    const otherTargetDamage = input.match.damages.some(
      (d) =>
        d.match_checksum === input.match.checksum &&
        d.round_number === segment.roundNumber &&
        d.attacker_steam_id === segment.shooterSteamId &&
        d.tick >= startTick &&
        d.tick <= endTick &&
        d.weapon_name === getEvidenceWeaponName(segment.itemDefinitionIndex) &&
        d.health_damage > 0 &&
        d.victim_steam_id !== targetSteamId,
    );
    if (otherTargetDamage) {
      reasons.add('target-switch');
      continue;
    }
    core.engagements.push({
      id: `engagement:${segment.id}`,
      shotIds: segment.shotIds,
      confirmedDamage: confirmations,
      targetSwitchObserved: false,
    });
    if (!input.geometryProvider) continue;
    for (const id of segment.shotIds) {
      const shot = core.shots.find((s) => s.id === id);
      const raw = rawById.get(id);
      if (!shot || !raw || !dbById.has(id)) continue;
      let result: SprayGeometryResult;
      try {
        result = await input.geometryProvider({
          shot,
          rawShot: raw,
          targetSteamId,
          frames: input.frames,
          maximumUnlagSeconds: input.maximumUnlagSeconds,
        });
      } catch {
        reasons.add('geometry-provider-error');
        continue;
      }
      if (result.status !== 'verified') {
        for (const reason of result.reasons) reasons.add(reason);
        continue;
      }
      const proof = result.provenance;
      if (
        !proof.providerVersion ||
        !proof.mapFingerprint ||
        proof.geometry !== 'verified-map-dynamic-and-smoke' ||
        proof.bodyBounds !== 'verified-full-body-conservative' ||
        proof.clock !== 'decoded-server-ticks'
      ) {
        reasons.add('geometry-provenance-unverified');
        continue;
      }
      if (
        result.frame.shotId !== id ||
        result.frame.shotTick !== shot.tick ||
        result.frame.targetSteamId !== targetSteamId
      ) {
        reasons.add('geometry-shot-mismatch');
        continue;
      }
      const frame = structuredClone(result.frame);
      // Event evidence can veto a provider's optimistic labels, never promote unknown visibility.
      const roundKills = input.match.kills.filter(
        (k) => k.match_checksum === input.match.checksum && k.round_number === segment.roundNumber,
      );
      if (
        roundKills.some(
          (k) =>
            k.victim_steam_id === targetSteamId &&
            (k.tick < shot.tick || (k.tick === shot.tick && k.frame <= raw.frame)),
        )
      )
        frame.targetLife = 'dead';
      if (
        input.match.blinds.some(
          (b) =>
            b.match_checksum === input.match.checksum &&
            b.round_number === segment.roundNumber &&
            b.flashed_steam_id === segment.shooterSteamId &&
            b.tick <= shot.tick &&
            b.tick + b.duration * input.header.tickRate >= shot.tick,
        )
      )
        frame.shooterBlinded = true;
      core.targetFrames.push(frame);
    }
  }
  const evidence = buildSprayEvidence(core);
  const evaluatedShots = evidence.points.filter((p) => p.target !== null && p.unavailableReason === null).length;
  for (const point of evidence.points) if (point.unavailableReason) reasons.add(point.unavailableReason);
  if (confirmedDamage === 0) reasons.add('no-unambiguous-damage-target');
  if (input.shots.length === 0) reasons.add('no-raw-shots');
  const eligibleCount = rawTrajectory.filter((s) => s.steamId === input.match.steamId).length;
  return {
    status: evaluatedShots === 0 ? 'blocked' : evaluatedShots < eligibleCount ? 'partial' : 'evaluated',
    reasons: [...reasons].sort(),
    rawTrajectory,
    evidence,
    coverage: {
      rawShots: rawTrajectory.length,
      identityVerified: rawTrajectory.filter((s) => s.identityVerified).length,
      databaseMatched: dbById.size,
      confirmedDamage,
      evaluatedShots,
    },
  };
}
