/** Raw FireBullets angles are the firing centre before random spread, already affected by recoil.
 * This module does not reconstruct impacts, mouse input, intent, or client-side visibility.
 * The target-frame attestations below must come from a separately verified geometry/time provider.
 */
type SprayVector = { x: number; y: number; z: number };
export type SprayBodyBox = { min: SprayVector; max: SprayVector };

export type SprayFireSample = {
  id: string;
  tick: number;
  roundNumber: number;
  shooterSteamId: string;
  weaponEntityId: string;
  itemDefinitionIndex: number;
  origin: SprayVector;
  angles: { pitch: number; yaw: number };
  recoilIndex: number | null;
  serverTick?: number;
  /** Only populate when an authoritative attack timestamp and its clock mapping were decoded. */
  attackTimeSeconds?: number;
  inaccuracy?: number;
  spread?: number;
};

type SprayEngagement = {
  id: string;
  shotIds: string[];
  /** Damage must have been unambiguously joined to a shot in this engagement. */
  confirmedDamage: { shotId: string; targetSteamId: string }[];
  targetSwitchObserved: boolean | null;
};

type SprayTargetTiming =
  | { kind: 'exact-shot-time'; attackTimeSeconds: number }
  | {
      kind: 'conservative-lag-envelope';
      /** All these times use the decoded server simulation clock, not demo tick / tickrate. */
      earliestPossibleTargetTime: number;
      latestPossibleTargetTime: number;
      coveredFrom: number;
      coveredThrough: number;
    }
  | { kind: 'unverified' };

export type SprayTargetFrame = {
  shotId: string;
  shotTick: number;
  targetSteamId: string;
  /** Union of conservative body bounds over EVERY possible time and pose in the timing range.
   * These must enclose the full player model; feet/eye points and guessed cylinders do not qualify.
   */
  bodyBoxes: SprayBodyBox[];
  timing: SprayTargetTiming;
  frameCoverage: 'complete' | 'missing';
  poseAndMotionCoverage: 'complete' | 'unknown';
  targetLife: 'alive' | 'dead' | 'unknown';
  targetRelation: 'enemy' | 'teammate' | 'unknown';
  /** Provider must exclude obscured/penetrating lines throughout the possible time envelope. */
  visibility: 'clear' | 'blocked' | 'unknown';
  shooterBlinded: boolean | null;
  throughSmoke: boolean | null;
};

type SprayUnavailableReason =
  | 'invalid-shot'
  | 'duplicate-shot-id'
  | 'ambiguous-same-tick'
  | 'unsupported-weapon'
  | 'missing-recoil'
  | 'missing-engagement'
  | 'ambiguous-engagement'
  | 'unconfirmed-target'
  | 'target-switch'
  | 'missing-target-frame'
  | 'ambiguous-target-frame'
  | 'unverified-time'
  | 'incomplete-geometry'
  | 'unclear-visibility'
  | 'blinded-or-unknown'
  | 'smoke-or-unknown';

type SprayTargetOffset = {
  targetSteamId: string;
  bearing: { pitch: number; yaw: number };
  /** Negative pitch is above; positive pitch is below. Yaw is unwrapped around bearing.yaw. */
  bodyPitch: { min: number; max: number };
  bodyYawOffset: { min: number; max: number };
  relativePitch: number;
  relativeYaw: number;
  /** Zero means the centre is inside the conservative angular envelope on that axis. */
  verticalOutsideDegrees: number;
  horizontalOutsideDegrees: number;
};

export type SprayEvidencePoint = {
  shotId: string;
  tick: number | null;
  segmentId: string | null;
  direction: { pitch: number; yaw: number } | null;
  origin: SprayVector | null;
  recoilIndex: number | null;
  target: SprayTargetOffset | null;
  unavailableReason: SprayUnavailableReason | null;
};

type SprayDiagnosis = {
  code: 'spray_center_rising' | 'spray_center_falling' | 'spray_center_lateral_crossings';
  targetSteamId: string;
  /** Evidence concerns firing centres relative to this damaged opponent, never actual impacts. */
  shotIds: string[];
  eventTick: number;
  peakOutsideDegrees: number;
  changeDegrees: number;
  crossingCount: number;
};

export type SprayEvidenceSegment = {
  id: string;
  shooterSteamId: string;
  roundNumber: number;
  weaponEntityId: string;
  itemDefinitionIndex: number;
  shotIds: string[];
  diagnoses: SprayDiagnosis[];
};

export type SprayEvidenceInput = {
  tickRate: number;
  /** Verified server configuration. Required for a conservative lag-compensation envelope. */
  maximumUnlagSeconds?: number;
  shots: SprayFireSample[];
  engagements: SprayEngagement[];
  targetFrames: SprayTargetFrame[];
};

/** Transparent review thresholds, not weapon physics or an accuracy score. */
const SPRAY_EVIDENCE_LIMITS = {
  minimumBurstShots: 8,
  maximumShotGapSeconds: 0.25,
  minimumOutsideRunShots: 3,
  minimumOutsideDegrees: 0.75,
  minimumDirectionalChangeDegrees: 1,
  minimumActualCentreChangeDegrees: 0.5,
  minimumLateralCrossings: 3,
  // Sanity bounds on parser/provider data, deliberately much wider than a normal player model.
  maximumCoordinate: 1_048_576,
  maximumBoxSpan: 4096,
  maximumTimingEnvelopeSeconds: 4,
} as const;

const automaticWeapons = new Set([7, 8, 10, 13, 14, 16, 17, 19, 23, 24, 26, 28, 33, 34, 39, 60]);
const degrees = 180 / Math.PI;

export function normalizeSprayYaw(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

function validCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= SPRAY_EVIDENCE_LIMITS.maximumCoordinate;
}

function validVector(value: SprayVector): boolean {
  return [value.x, value.y, value.z].every(validCoordinate);
}

function validShot(shot: SprayFireSample): boolean {
  return (
    shot.id.length > 0 &&
    shot.shooterSteamId.length > 0 &&
    shot.weaponEntityId.length > 0 &&
    Number.isSafeInteger(shot.tick) &&
    shot.tick >= 0 &&
    Number.isSafeInteger(shot.roundNumber) &&
    shot.roundNumber > 0 &&
    Number.isSafeInteger(shot.itemDefinitionIndex) &&
    validVector(shot.origin) &&
    Number.isFinite(shot.angles.pitch) &&
    Math.abs(shot.angles.pitch) <= 90 &&
    Number.isFinite(shot.angles.yaw) &&
    Math.abs(shot.angles.yaw) <= 3600
  );
}

function validBox(box: SprayBodyBox, origin: SprayVector): boolean {
  if (!validVector(box.min) || !validVector(box.max)) {
    return false;
  }
  const axes = ['x', 'y', 'z'] as const;
  if (
    axes.some((axis) => {
      const span = box.max[axis] - box.min[axis];
      return span <= 0 || span > SPRAY_EVIDENCE_LIMITS.maximumBoxSpan;
    })
  ) {
    return false;
  }
  return !axes.every((axis) => origin[axis] >= box.min[axis] && origin[axis] <= box.max[axis]);
}

function bearing(origin: SprayVector, target: SprayVector) {
  const x = target.x - origin.x;
  const y = target.y - origin.y;
  const z = target.z - origin.z;
  return { pitch: -Math.atan2(z, Math.hypot(x, y)) * degrees, yaw: Math.atan2(y, x) * degrees };
}

function outside(value: number, min: number, max: number): number {
  return value < min ? value - min : value > max ? value - max : 0;
}

/** Project the UNION, never whichever box produces the strongest deviation. */
function projectTarget(shot: SprayFireSample, target: SprayTargetFrame): SprayTargetOffset | null {
  if (target.bodyBoxes.length === 0 || target.bodyBoxes.some((box) => !validBox(box, shot.origin))) {
    return null;
  }
  const merged: SprayBodyBox = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (const box of target.bodyBoxes) {
    for (const axis of ['x', 'y', 'z'] as const) {
      merged.min[axis] = Math.min(merged.min[axis], box.min[axis]);
      merged.max[axis] = Math.max(merged.max[axis], box.max[axis]);
    }
  }
  // Merging also encloses the gaps between possible target positions, deliberately conservative.
  if (!validBox(merged, shot.origin)) {
    return null;
  }
  const centre = {
    x: (merged.min.x + merged.max.x) / 2,
    y: (merged.min.y + merged.max.y) / 2,
    z: (merged.min.z + merged.max.z) / 2,
  };
  const targetBearing = bearing(shot.origin, centre);
  const yaw: number[] = [];
  const pitch: number[] = [];
  // Include the closest horizontal point as well as corners: pitch extrema need not be corners.
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const xs = [merged.min.x, merged.max.x, clamp(shot.origin.x, merged.min.x, merged.max.x)];
  const ys = [merged.min.y, merged.max.y, clamp(shot.origin.y, merged.min.y, merged.max.y)];
  for (const x of xs) {
    for (const y of ys) {
      // A target crossing the vertical axis cannot have a bounded horizontal angular envelope.
      if (x === shot.origin.x && y === shot.origin.y) {
        return null;
      }
      for (const z of [merged.min.z, merged.max.z]) {
        const direction = bearing(shot.origin, { x, y, z });
        yaw.push(normalizeSprayYaw(direction.yaw - targetBearing.yaw));
        pitch.push(direction.pitch);
      }
    }
  }
  const pitchMin = Math.min(...pitch);
  const pitchMax = Math.max(...pitch);
  const yawMin = Math.min(...yaw);
  const yawMax = Math.max(...yaw);
  if (yawMax - yawMin >= 180) {
    return null;
  }
  const relativeYaw = normalizeSprayYaw(shot.angles.yaw - targetBearing.yaw);
  return {
    targetSteamId: target.targetSteamId,
    bearing: targetBearing,
    bodyPitch: { min: pitchMin, max: pitchMax },
    bodyYawOffset: { min: yawMin, max: yawMax },
    relativePitch: shot.angles.pitch - targetBearing.pitch,
    relativeYaw,
    verticalOutsideDegrees: outside(shot.angles.pitch, pitchMin, pitchMax),
    horizontalOutsideDegrees: outside(relativeYaw, yawMin, yawMax),
  };
}

function verifiedTiming(shot: SprayFireSample, timing: SprayTargetTiming, input: SprayEvidenceInput): boolean {
  if (timing.kind === 'exact-shot-time') {
    return (
      Number.isFinite(shot.attackTimeSeconds) &&
      (shot.attackTimeSeconds as number) >= 0 &&
      Number.isFinite(timing.attackTimeSeconds) &&
      shot.attackTimeSeconds === timing.attackTimeSeconds
    );
  }
  if (timing.kind !== 'conservative-lag-envelope') {
    return false;
  }
  const {
    earliestPossibleTargetTime: earliest,
    latestPossibleTargetTime: latest,
    coveredFrom,
    coveredThrough,
  } = timing;
  const maximumUnlag = input.maximumUnlagSeconds;
  if (
    !Number.isSafeInteger(shot.serverTick) ||
    (shot.serverTick as number) < 0 ||
    maximumUnlag === undefined ||
    !Number.isFinite(maximumUnlag) ||
    maximumUnlag < 0 ||
    maximumUnlag > SPRAY_EVIDENCE_LIMITS.maximumTimingEnvelopeSeconds
  ) {
    return false;
  }
  const serverTime = (shot.serverTick as number) / input.tickRate;
  return (
    [earliest, latest, coveredFrom, coveredThrough].every(Number.isFinite) &&
    earliest >= 0 &&
    coveredFrom >= 0 &&
    latest > earliest &&
    earliest <= serverTime - 1 / input.tickRate - maximumUnlag &&
    latest >= serverTime &&
    coveredFrom <= earliest &&
    coveredThrough >= latest &&
    coveredThrough - coveredFrom <= SPRAY_EVIDENCE_LIMITS.maximumTimingEnvelopeSeconds
  );
}

function frameReason(
  shot: SprayFireSample,
  frame: SprayTargetFrame,
  input: SprayEvidenceInput,
): SprayUnavailableReason | null {
  if (frame.shotTick !== shot.tick || !verifiedTiming(shot, frame.timing, input)) {
    return 'unverified-time';
  }
  if (frame.frameCoverage !== 'complete' || frame.poseAndMotionCoverage !== 'complete') {
    return 'incomplete-geometry';
  }
  if (frame.targetLife !== 'alive' || frame.targetRelation !== 'enemy') {
    return 'unconfirmed-target';
  }
  if (frame.visibility !== 'clear') {
    return 'unclear-visibility';
  }
  if (frame.shooterBlinded !== false) {
    return 'blinded-or-unknown';
  }
  if (frame.throughSmoke !== false) {
    return 'smoke-or-unknown';
  }
  return null;
}

function diagnoseRun(points: SprayEvidencePoint[]): SprayDiagnosis[] {
  const limits = SPRAY_EVIDENCE_LIMITS;
  if (points.length < limits.minimumBurstShots || points.some((p) => !p.target)) {
    return [];
  }
  const offsets = points.map((p) => p.target as SprayTargetOffset);
  const last = points.at(-1) as SprayEvidencePoint;
  const base = {
    targetSteamId: offsets[0].targetSteamId,
    shotIds: points.map((p) => p.shotId),
    eventTick: last.tick as number,
  };
  const result: SprayDiagnosis[] = [];
  // Start with two centres inside both body angular bounds. Only subsequent departure is labelled.
  const initiallyAligned = offsets
    .slice(0, 2)
    .every((p) => p.verticalOutsideDegrees === 0 && p.horizontalOutsideDegrees === 0);
  const tail = offsets.slice(-limits.minimumOutsideRunShots);
  const firstPitch = (offsets[0].relativePitch + offsets[1].relativePitch) / 2;
  const lastPitch = tail.reduce((sum, p) => sum + p.relativePitch, 0) / tail.length;
  const change = lastPitch - firstPitch;
  const firstActualPitch = ((points[0].direction?.pitch ?? 0) + (points[1].direction?.pitch ?? 0)) / 2;
  const lastActualPitch =
    points.slice(-limits.minimumOutsideRunShots).reduce((sum, p) => sum + (p.direction?.pitch ?? 0), 0) /
    limits.minimumOutsideRunShots;
  const actualChange = lastActualPitch - firstActualPitch;
  if (initiallyAligned) {
    for (const sign of [-1, 1]) {
      if (
        sign * change >= limits.minimumDirectionalChangeDegrees &&
        sign * actualChange >= limits.minimumActualCentreChangeDegrees &&
        tail.every((p) => sign * p.verticalOutsideDegrees >= limits.minimumOutsideDegrees)
      ) {
        result.push({
          ...base,
          code: sign < 0 ? 'spray_center_rising' : 'spray_center_falling',
          peakOutsideDegrees: Math.max(...tail.map((p) => Math.abs(p.verticalOutsideDegrees))),
          changeDegrees: Math.abs(change),
          crossingCount: 0,
        });
      }
    }
  }
  // A crossing requires centres beyond opposite envelope edges, not tiny yaw changes/recoil jitter.
  let previousSide = 0;
  let crossings = 0;
  for (const p of offsets) {
    if (Math.abs(p.horizontalOutsideDegrees) < limits.minimumOutsideDegrees) {
      continue;
    }
    const side = Math.sign(p.horizontalOutsideDegrees);
    if (previousSide !== 0 && side !== previousSide) {
      crossings++;
    }
    previousSide = side;
  }
  if (crossings >= limits.minimumLateralCrossings) {
    const relativeYaws = offsets.map((p) => p.relativeYaw);
    // Do not call a 180-degree turn an oscillation around the same opponent.
    const range = Math.max(...relativeYaws) - Math.min(...relativeYaws);
    let actualReversals = 0;
    let previousActualSide = 0;
    for (let index = 1; index < points.length; index++) {
      const delta = normalizeSprayYaw((points[index].direction?.yaw ?? 0) - (points[index - 1].direction?.yaw ?? 0));
      if (Math.abs(delta) < limits.minimumActualCentreChangeDegrees) {
        continue;
      }
      const side = Math.sign(delta);
      if (previousActualSide !== 0 && side !== previousActualSide) {
        actualReversals++;
      }
      previousActualSide = side;
    }
    if (range < 180 && actualReversals >= limits.minimumLateralCrossings) {
      result.push({
        ...base,
        code: 'spray_center_lateral_crossings',
        peakOutsideDegrees: Math.max(...offsets.map((p) => Math.abs(p.horizontalOutsideDegrees))),
        changeDegrees: range,
        crossingCount: crossings,
      });
    }
  }
  return result;
}

export function buildSprayEvidence(input: SprayEvidenceInput): {
  points: SprayEvidencePoint[];
  segments: SprayEvidenceSegment[];
} {
  const points: SprayEvidencePoint[] = [];
  const segments: SprayEvidenceSegment[] = [];
  const idCounts = new Map<string, number>();
  const tickCounts = new Map<string, number>();
  const tickKey = (s: SprayFireSample) => JSON.stringify([s.shooterSteamId, s.roundNumber, s.tick]);
  for (const shot of input.shots) {
    idCounts.set(shot.id, (idCounts.get(shot.id) ?? 0) + 1);
    tickCounts.set(tickKey(shot), (tickCounts.get(tickKey(shot)) ?? 0) + 1);
  }
  const tickRateValid = Number.isFinite(input.tickRate) && input.tickRate > 0 && input.tickRate <= 512;
  const ordered = input.shots.toSorted(
    (a, b) => a.shooterSteamId.localeCompare(b.shooterSteamId) || a.roundNumber - b.roundNumber || a.tick - b.tick,
  );
  let current: SprayEvidenceSegment | undefined;
  let previous: SprayFireSample | undefined;
  const pointEngagements = new Map<SprayEvidencePoint, string>();
  for (const shot of ordered) {
    const valid = validShot(shot);
    const recoilValid = shot.recoilIndex !== null && Number.isFinite(shot.recoilIndex) && shot.recoilIndex >= 0;
    const point: SprayEvidencePoint = {
      shotId: shot.id,
      tick: Number.isSafeInteger(shot.tick) && shot.tick >= 0 ? shot.tick : null,
      segmentId: null,
      direction: valid ? { pitch: shot.angles.pitch, yaw: normalizeSprayYaw(shot.angles.yaw) } : null,
      origin: valid ? shot.origin : null,
      recoilIndex: recoilValid ? shot.recoilIndex : null,
      target: null,
      unavailableReason: null,
    };
    points.push(point);
    if (!valid || !tickRateValid) {
      point.unavailableReason = 'invalid-shot';
      current = undefined;
      previous = undefined;
      continue;
    }
    const contiguous =
      previous &&
      current &&
      previous.shooterSteamId === shot.shooterSteamId &&
      previous.roundNumber === shot.roundNumber &&
      previous.weaponEntityId === shot.weaponEntityId &&
      previous.itemDefinitionIndex === shot.itemDefinitionIndex &&
      shot.tick > previous.tick &&
      (shot.tick - previous.tick) / input.tickRate <= SPRAY_EVIDENCE_LIMITS.maximumShotGapSeconds &&
      recoilValid &&
      previous.recoilIndex !== null &&
      (shot.recoilIndex as number) > previous.recoilIndex;
    if (!contiguous || !current) {
      current = {
        id: `spray:${shot.shooterSteamId}:${shot.roundNumber}:${shot.id}`,
        shooterSteamId: shot.shooterSteamId,
        roundNumber: shot.roundNumber,
        weaponEntityId: shot.weaponEntityId,
        itemDefinitionIndex: shot.itemDefinitionIndex,
        shotIds: [],
        diagnoses: [],
      };
      segments.push(current);
    }
    previous = shot;
    current.shotIds.push(shot.id);
    point.segmentId = current.id;
    if ((idCounts.get(shot.id) ?? 0) !== 1) {
      point.unavailableReason = 'duplicate-shot-id';
      continue;
    }
    if ((tickCounts.get(tickKey(shot)) ?? 0) !== 1) {
      point.unavailableReason = 'ambiguous-same-tick';
      continue;
    }
    if (!automaticWeapons.has(shot.itemDefinitionIndex)) {
      point.unavailableReason = 'unsupported-weapon';
      continue;
    }
    if (!recoilValid) {
      point.unavailableReason = 'missing-recoil';
      continue;
    }
    const engagements = input.engagements.filter((e) => e.shotIds.includes(shot.id));
    if (engagements.length !== 1) {
      point.unavailableReason = engagements.length === 0 ? 'missing-engagement' : 'ambiguous-engagement';
      continue;
    }
    const engagement = engagements[0];
    if (input.engagements.filter((e) => e.id === engagement.id).length !== 1) {
      point.unavailableReason = 'ambiguous-engagement';
      continue;
    }
    if (engagement.targetSwitchObserved !== false) {
      point.unavailableReason = 'target-switch';
      continue;
    }
    const targets = new Set(
      engagement.confirmedDamage.filter((d) => engagement.shotIds.includes(d.shotId)).map((d) => d.targetSteamId),
    );
    const targetSteamId = [...targets][0];
    // Grounding references must exist exactly once in this same firing segment, not another round.
    const references = engagement.confirmedDamage.filter((d) => d.targetSteamId === targetSteamId);
    const grounded = references.some((d) =>
      input.shots.some(
        (s) =>
          s.id === d.shotId &&
          validShot(s) &&
          s.shooterSteamId === shot.shooterSteamId &&
          s.roundNumber === shot.roundNumber &&
          s.weaponEntityId === shot.weaponEntityId &&
          s.itemDefinitionIndex === shot.itemDefinitionIndex &&
          idCounts.get(s.id) === 1,
      ),
    );
    if (targets.size !== 1 || !targetSteamId || targetSteamId === shot.shooterSteamId || !grounded) {
      point.unavailableReason = 'unconfirmed-target';
      continue;
    }
    const frames = input.targetFrames.filter((f) => f.shotId === shot.id && f.targetSteamId === targetSteamId);
    if (frames.length !== 1) {
      point.unavailableReason = frames.length === 0 ? 'missing-target-frame' : 'ambiguous-target-frame';
      continue;
    }
    const frame = frames[0];
    point.unavailableReason = frameReason(shot, frame, input);
    if (point.unavailableReason) {
      continue;
    }
    point.target = projectTarget(shot, frame);
    if (!point.target) {
      point.unavailableReason = 'incomplete-geometry';
      continue;
    }
    pointEngagements.set(point, engagement.id);
  }
  for (const segment of segments) {
    const segmentPoints = points.filter((p) => p.segmentId === segment.id);
    let run: SprayEvidencePoint[] = [];
    const flush = () => {
      if (run.length > 0) {
        const engagement = input.engagements.find((e) => e.id === pointEngagements.get(run[0]));
        const hasLocalDamage = engagement?.confirmedDamage.some((d) => run.some((p) => p.shotId === d.shotId));
        if (hasLocalDamage) {
          segment.diagnoses.push(...diagnoseRun(run));
        }
      }
      run = [];
    };
    for (const point of segmentPoints) {
      if (
        point.unavailableReason ||
        (run.length > 0 &&
          (pointEngagements.get(point) !== pointEngagements.get(run[0]) ||
            point.target?.targetSteamId !== run[0].target?.targetSteamId))
      ) {
        flush();
      }
      if (!point.unavailableReason) {
        run.push(point);
      }
    }
    flush();
  }
  return { points, segments };
}
