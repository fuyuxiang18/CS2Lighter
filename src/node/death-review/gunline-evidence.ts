import type { DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import { setImmediate } from 'node:timers/promises';
import {
  evidenceNumber,
  evidenceVector,
  type EvidenceEnd,
  type EvidenceEntity,
  type EvidenceFrame,
  type EvidencePlayer,
  type EvidenceSmoke,
} from 'csdm/node/death-review/evidence-protocol';
import {
  findMultipleEnemyExposure,
  type VisibilityVector,
  type VisibilityTrace,
} from 'csdm/node/death-review/visibility-geometry';
import { traceVisibilityMeshGunline } from 'csdm/node/death-review/visibility-mesh';
import type { resolveVisibilityMap } from 'csdm/node/death-review/visibility-map-provider';
import type { Source2ModelResourceResult } from 'csdm/node/death-review/source2-model-resources';

type ReadyMap = Extract<Awaited<ReturnType<typeof resolveVisibilityMap>>, { status: 'ready' }>;
type Bound = { min: VisibilityVector; max: VisibilityVector };
export type GunlineEntityBounds =
  | { status: 'bounded'; bounds: Bound; source: string }
  | { status: 'non-rendering'; source: string }
  | { status: 'unavailable'; reasons: string[] };
type Input = {
  frames: EvidenceFrame[];
  end: EvidenceEnd;
  tickrate: number;
  targetSteamId: string;
  map: ReadyMap;
  resolveEntityBounds: (entity: EvidenceEntity) => Promise<GunlineEntityBounds>;
  signal?: AbortSignal;
};
type Result = {
  basis: 'environment-eye-reference';
  status: 'evaluated' | 'partial' | 'unavailable';
  reasons: string[];
  gunlines: DeathEvidenceReport['gunlines'];
  exposures: DeathEvidenceReport['exposures'];
};

function validVector(value: VisibilityVector | null): value is VisibilityVector {
  return value !== null && value.length === 3 && value.every(Number.isFinite);
}
function validBounds(bounds: Bound) {
  return validVector(bounds.min) && validVector(bounds.max) && bounds.min.every((v, axis) => v < bounds.max[axis]);
}
function alive(player: EvidencePlayer) {
  return player.lifeState === 0 && player.health !== null && player.health > 0 && [2, 3].includes(player.team ?? 0);
}
function facingOffset(player: EvidencePlayer, target: VisibilityVector): number | null {
  if (
    !validVector(player.eyes) ||
    player.yaw === null ||
    player.pitch === null ||
    !Number.isFinite(player.yaw) ||
    !Number.isFinite(player.pitch)
  )
    return null;
  const pitch = (player.pitch * Math.PI) / 180,
    yaw = (player.yaw * Math.PI) / 180;
  const forward = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)];
  const delta = target.map((v, a) => v - player.eyes![a]);
  const length = Math.hypot(...delta);
  if (!length) return null;
  return (
    (Math.acos(Math.max(-1, Math.min(1, delta.reduce((sum, v, a) => sum + v * forward[a], 0) / length))) * 180) /
    Math.PI
  );
}
function ignoredEnvironmentClass(name: string) {
  // These are excluded by the stated environment-only measurement, not assumed
  // invisible on screen. Movable map props/brushes/doors are never excluded here.
  return (
    ['CWorld', 'CBombTarget', 'CPostProcessingVolume', 'CEnvSky', 'CCSObserverPawn'].includes(name) ||
    /^(?:CWeapon|CKnife|CAK47$|CDEagle$|CC4$|CFlashbang|CHEGrenade|CSmokeGrenade|CMolotov|CIncendiaryGrenade|CDecoyGrenade)/.test(
      name,
    )
  );
}
function smokeInactive(smoke: EvidenceSmoke) {
  const did = smoke.fields.m_bDidSmokeEffect;
  return did?.present === true && did.value === false && smoke.declaredSize === 0;
}
function unknown(): VisibilityTrace {
  return { status: 'unknown', reason: 'dynamic-incomplete', rays: [] };
}

/** Environment-only eye-reference segments; neither attention nor a hittable animated hitbox is inferred. */
export async function buildGunlineEvidence(input: Input): Promise<Result> {
  const result: Result = {
    basis: 'environment-eye-reference',
    status: 'unavailable',
    reasons: [],
    gunlines: [],
    exposures: [],
  };
  if (
    !Number.isFinite(input.tickrate) ||
    input.tickrate <= 0 ||
    input.end.status !== 'ok' ||
    input.frames.length > 4096 ||
    !/^\d{17}$/.test(input.targetSteamId)
  ) {
    result.reasons = ['invalid-extraction'];
    return result;
  }
  const reasons = new Set<string>();
  const world = new Map<string, EvidenceEntity>(),
    smokes = new Map<string, EvidenceSmoke>();
  const bounds = new Map<string, GunlineEntityBounds>();
  const exposureFrames: Parameters<typeof findMultipleEnemyExposure>[0] = [];
  let worldReady = false,
    smokeReady = false,
    previousTick = -1;
  const missing = new Set(input.end.missingTicks);
  if (missing.size) reasons.add('missing-extraction-ticks');
  const unsupported = input.end.unsupportedClasses;
  const candidateCoverage =
    input.end.capabilities?.includes('environment-model-candidates') === true && unsupported !== undefined;
  if (!candidateCoverage) reasons.add('environment-candidate-coverage-unverified');
  const knownNonGeometry =
    /^(?:CCSGO_|CCSGameRulesProxy$|CCSMinimapBoundary$|CCSPlayerController$|CCSPlayerResource$|CCSTeam$|CEnvCubemapFog$|CEnvLightProbeVolume$|CEnvWind$|CGradientFog$|CParticleSystem$|CPlayerPing$|CPointCamera$|CPointEntity$|CSkyCamera$|CSoundEventPathCornerEntity$|CVoteController$|CInferno$)/;
  const unknownClasses = Object.keys(unsupported ?? {}).filter(
    (name) => !knownNonGeometry.test(name) && !ignoredEnvironmentClass(name),
  );
  if (unknownClasses.length) reasons.add(`unsupported-environment-classes:${unknownClasses.sort().join(',')}`);

  for (const frame of input.frames) {
    await setImmediate();
    input.signal?.throwIfAborted();
    if (!Number.isSafeInteger(frame.tick) || frame.tick <= previousTick || missing.has(frame.tick)) {
      reasons.add('invalid-extraction-order');
      worldReady = false;
      smokeReady = false;
      continue;
    }
    if (previousTick >= 0 && frame.tick !== previousTick + 1) {
      worldReady = false;
      smokeReady = false;
    }
    previousTick = frame.tick;
    if (frame.world.complete) {
      world.clear();
      bounds.clear();
      worldReady = true;
    }
    for (const id of frame.world.removed) {
      world.delete(id);
      bounds.delete(id);
    }
    for (const entity of frame.world.upserts) {
      world.set(entity.id, entity);
      if (!ignoredEnvironmentClass(entity.className)) {
        try {
          bounds.set(entity.id, await input.resolveEntityBounds(entity));
        } catch {
          input.signal?.throwIfAborted();
          bounds.set(entity.id, { status: 'unavailable', reasons: ['dynamic-model-resolution-failed'] });
        }
      }
    }
    if (frame.smokes.complete) {
      smokes.clear();
      smokeReady = true;
    }
    for (const id of frame.smokes.removed) smokes.delete(id);
    for (const smoke of frame.smokes.upserts) smokes.set(smoke.id, smoke);
    const target = frame.players.find((player) => player.steamId === input.targetSteamId);
    if (!target || !alive(target) || !validVector(target.eyes)) continue;
    const frameReason = !candidateCoverage
      ? 'environment-candidate-coverage-unverified'
      : !worldReady
        ? 'world-baseline-missing'
        : !smokeReady
          ? 'smoke-baseline-missing'
          : [...smokes.values()].some((smoke) => !smokeInactive(smoke))
            ? 'active-smoke-bounds-unverified'
            : unknownClasses.length
              ? 'unsupported-environment-classes'
              : null;
    const volumes: { id: string; min: VisibilityVector; max: VisibilityVector }[] = [];
    const unbounded: string[] = [];
    for (const [id, entity] of world) {
      if (ignoredEnvironmentClass(entity.className)) continue;
      const bound = bounds.get(id);
      if (bound?.status === 'non-rendering' && bound.source) continue;
      if (bound?.status === 'bounded' && bound.source && validBounds(bound.bounds))
        volumes.push({ id, ...bound.bounds });
      else unbounded.push(entity.className);
    }
    const frameResult = {
      tick: frame.tick,
      timeSeconds: frame.tick / input.tickrate,
      observerEye: target.eyes,
      enemies: [] as Parameters<typeof findMultipleEnemyExposure>[0][number]['enemies'],
    };
    for (const enemy of frame.players) {
      if (
        enemy.team === target.team ||
        !alive(enemy) ||
        !validVector(enemy.eyes) ||
        !enemy.steamId ||
        !/^\d{17}$/.test(enemy.steamId)
      )
        continue;
      const blockedReason =
        frameReason ??
        (unbounded.length ? `unbounded-dynamic-model:${[...new Set(unbounded)].sort().join(',')}` : null);
      let trace: VisibilityTrace;
      let reason: string;
      if (blockedReason) {
        trace = unknown();
        reason = blockedReason;
      } else {
        trace = await traceVisibilityMeshGunline({
          mesh: input.map.mesh,
          provenance: input.map.provenance,
          viewer: { eye: enemy.eyes, eyeCertified: true },
          target: { referencePoint: target.eyes, reference: 'decoded-eye', referenceCertified: true },
          dynamics: { complete: true, opaqueVolumes: [], unknownVolumes: volumes },
          clearanceUnits: 0.1,
          signal: input.signal,
        });
        reason = trace.reason;
      }
      if (trace.status === 'unknown') reasons.add(reason);
      result.gunlines.push({
        tick: frame.tick,
        enemySteamId: enemy.steamId,
        distance: Math.hypot(...enemy.eyes.map((v, a) => v - target.eyes![a])),
        facingOffset: facingOffset(enemy, target.eyes),
        status: trace.status,
        reason,
      });
      frameResult.enemies.push({ id: enemy.steamId, eye: enemy.eyes, trace });
    }
    exposureFrames.push(frameResult);
  }
  const episodes = [2, 3, 4, 5].flatMap((atLeastEnemies) =>
    findMultipleEnemyExposure(exposureFrames, {
      atLeastEnemies,
      minimumDurationSeconds: 0.2,
      maximumGapSeconds: 1.5 / input.tickrate,
      minimumAngleDegrees: atLeastEnemies === 2 ? 30 : 0,
    }),
  );
  result.exposures = episodes
    .filter(
      (episode) =>
        !episodes.some(
          (larger) =>
            larger.enemyIds.length > episode.enemyIds.length &&
            larger.startTick <= episode.startTick &&
            larger.endTick >= episode.endTick &&
            episode.enemyIds.every((id) => larger.enemyIds.includes(id)),
        ),
    )
    .sort(
      (a, b) =>
        a.startTick - b.startTick ||
        b.enemyIds.length - a.enemyIds.length ||
        a.enemyIds.join().localeCompare(b.enemyIds.join()),
    );
  const evaluated = result.gunlines.filter((line) => line.status !== 'unknown').length;
  result.status = evaluated === 0 ? 'unavailable' : evaluated === result.gunlines.length ? 'evaluated' : 'partial';
  result.reasons = [...reasons].sort();
  if (!result.gunlines.length) result.reasons.push('no-living-opponent-eye-pairs');
  return result;
}

/** Rigid Source pitch/yaw/roll with all authored model corners transformed, never collision hull substitution. */
export function transformGunlineModelBounds(
  entity: EvidenceEntity,
  model: Bound,
  source: 'authored-rigid-render-bounds' | 'water-volume' = 'authored-rigid-render-bounds',
): GunlineEntityBounds {
  const prefix = 'CBodyComponent.m_skeletonInstance.';
  const angles = evidenceVector(entity.fields[`${prefix}m_angRotation`]);
  const scale = evidenceNumber(entity.fields[`${prefix}m_flScale`]);
  const parent = evidenceNumber(entity.fields[`${prefix}m_hParent`]);
  const unshiftedRoot = ['x', 'y', 'z'].every(
    (axis) => evidenceNumber(entity.fields[`${prefix}m_modelState.m_flRootBoneOffset_${axis}`]) === 0,
  );
  if (
    !validVector(entity.origin) ||
    !angles ||
    scale === null ||
    scale <= 0 ||
    scale > 100 ||
    (parent !== 16777215 && parent !== 4294967295) ||
    !validVector(model.min) ||
    !validVector(model.max) ||
    model.min.some((value, axis) => value > model.max[axis]) ||
    !unshiftedRoot
  )
    return { status: 'unavailable', reasons: ['dynamic-transform-unverified'] };
  const [p, y, r] = angles.map((v) => (v * Math.PI) / 180),
    cp = Math.cos(p),
    sp = Math.sin(p),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cr = Math.cos(r),
    sr = Math.sin(r);
  const matrix = [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
  const corners = Array.from({ length: 8 }, (_, i) =>
    [0, 1, 2].map((a) => (i & (1 << a) ? model.max[a] : model.min[a])),
  );
  const world = corners.map((corner) =>
    [0, 1, 2].map((a) => entity.origin![a] + scale * corner.reduce((sum, v, b) => sum + matrix[a][b] * v, 0)),
  );
  return {
    status: 'bounded',
    source,
    bounds: {
      min: [0, 1, 2].map((a) => Math.min(...world.map((v) => v[a])) - 0.01) as unknown as VisibilityVector,
      max: [0, 1, 2].map((a) => Math.max(...world.map((v) => v[a])) + 0.01) as unknown as VisibilityVector,
    },
  };
}

/** Keep resource absence, rigid render envelopes and functional water volumes distinct. */
export function resolveGunlineEntityBounds(
  entity: EvidenceEntity,
  model: Source2ModelResourceResult,
): GunlineEntityBounds {
  if (model.status !== 'ready') return { status: 'unavailable', reasons: [model.reason] };
  if (entity.className === 'CBaseModelEntity' && model.resourceHasNoRenderMeshes)
    return { status: 'non-rendering', source: 'verified-empty-base-model-render-resource' };
  if (entity.className === 'CFuncWater') {
    const min = evidenceVector(entity.fields['m_Collision.m_vecMins']);
    const max = evidenceVector(entity.fields['m_Collision.m_vecMaxs']);
    if (
      !model.resourceHasNoRenderMeshes ||
      !model.physicsBounds ||
      !min ||
      !max ||
      model.physicsBounds.min.some((value, axis) => Math.abs(value - min[axis]) > 0.001) ||
      model.physicsBounds.max.some((value, axis) => Math.abs(value - max[axis]) > 0.001)
    )
      return { status: 'unavailable', reasons: ['water-physics-volume-unverified'] };
    return transformGunlineModelBounds(entity, model.physicsBounds, 'water-volume');
  }
  if (!model.rigidBounds) return { status: 'unavailable', reasons: model.blockingReasons };
  const graph = entity.fields['CBodyComponent.m_animationController.m_hGraphDefinitionAG2'];
  if (
    (graph?.present && graph.value !== 0 && graph.value !== '0') ||
    (model.boundsKind === 'rotation-envelope' && !graph?.present) ||
    ['m_bClientSideRagdoll', 'm_bRagdollClientSide'].some((key) => entity.fields[key]?.value === true)
  )
    return { status: 'unavailable', reasons: ['dynamic-animation-state-unverified'] };
  return transformGunlineModelBounds(entity, model.rigidBounds);
}
