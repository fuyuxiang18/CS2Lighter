// Offline geometry only. A clear result requires certified map, eye, body points,
// FOV and dynamic coverage. Unknown evidence must never become a visible player.
export type VisibilityVector = readonly [number, number, number];

type Triangle = { id: string; a: VisibilityVector; b: VisibilityVector; c: VisibilityVector };
type Volume = { id: string; min: VisibilityVector; max: VisibilityVector };
type Node = { min: VisibilityVector; max: VisibilityVector; triangles?: Triangle[]; children?: [Node, Node] };
type Provenance = {
  mapName: string;
  sourceFingerprint: string | null;
  demoFingerprint: string | null;
  matchType?: 'demo-fingerprint' | 'installed-build-matched';
  buildMatch?: { demoPatch: number; installedPatch: number; clientVersion: number; buildId: number };
  coordinates: 'source';
  opaqueCoverageComplete: boolean;
  coordinateErrorUnits?: number;
  // Optional region after conservative spatial filtering of a full map asset.
  // A query outside it cannot use the filtered geometry as complete coverage.
  coverageBounds?: { min: VisibilityVector; max: VisibilityVector };
};
type VisibilityGeometry = { provenance: Provenance; root: Node };
type Status = 'unknown' | 'blocked' | 'clear';
type Reason =
  | 'map-unverified'
  | 'geometry-incomplete'
  | 'eye-unverified'
  | 'body-unverified'
  | 'fov-unverified'
  | 'flash-unverified'
  | 'dynamic-incomplete'
  | 'invalid-input'
  | 'flashed'
  | 'outside-fov'
  | 'occluded'
  | 'dynamic-uncertain'
  | 'edge-clearance'
  | 'volume-occluded'
  | 'clear';
export type VisibilityTrace = {
  status: Status;
  reason: Reason;
  rays: {
    target: VisibilityVector;
    status: Status;
    reason: Reason;
    obstacleId: string | null;
    distance: number | null;
  }[];
};
type TraceInput = {
  geometry: VisibilityGeometry;
  viewer: {
    eye: VisibilityVector;
    forward: VisibilityVector;
    horizontalFov: number;
    verticalFov: number;
    eyeCertified: boolean;
    fovCertified: boolean;
    flashClear: boolean | null;
  };
  target: { points: VisibilityVector[]; pointsCertified: boolean };
  dynamics: { complete: boolean; opaqueVolumes: Volume[]; unknownVolumes: Volume[] };
  // Rays passing within this distance of a triangle or volume remain unknown.
  clearanceUnits: number;
};
type GunlineInput = Omit<TraceInput, 'viewer' | 'target'> & {
  viewer: { eye: VisibilityVector; eyeCertified: boolean };
  target: { referencePoint: VisibilityVector; reference: 'decoded-eye'; referenceCertified: boolean };
};
type ExposureFrame = {
  tick: number;
  timeSeconds: number;
  observerEye: VisibilityVector;
  enemies: { id: string; eye: VisibilityVector; trace: VisibilityTrace }[];
};
type Exposure = {
  startTick: number;
  endTick: number;
  startSeconds: number;
  endSeconds: number;
  enemyIds: string[];
  minimumAngleDegrees: number;
  samples: number;
};

function finite(v: VisibilityVector) {
  return v.length === 3 && v.every(Number.isFinite);
}
function sub(a: VisibilityVector, b: VisibilityVector): VisibilityVector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function addScaled(a: VisibilityVector, b: VisibilityVector, scale: number): VisibilityVector {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}
function dot(a: VisibilityVector, b: VisibilityVector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: VisibilityVector, b: VisibilityVector): VisibilityVector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(a: VisibilityVector) {
  return Math.sqrt(dot(a, a));
}
function unit(a: VisibilityVector): VisibilityVector {
  const n = length(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
function clamp(n: number) {
  return Math.max(0, Math.min(1, n));
}
function copy(v: VisibilityVector): VisibilityVector {
  return [v[0], v[1], v[2]];
}
function validVolume(v: Volume) {
  return finite(v.min) && finite(v.max) && v.min.every((value, axis) => value <= v.max[axis]);
}

export function buildVisibilityGeometry(input: { provenance: Provenance; triangles: Triangle[] }): VisibilityGeometry {
  // This object-based BVH is deliberately for bounded death-window regions.
  // Full maps must be retained as packed buffers and spatially filtered first.
  if ((input.triangles.length === 0 && !input.provenance.coverageBounds) || input.triangles.length > 100_000)
    throw new Error('Invalid visibility triangle count');
  const triangles = input.triangles.map((t) => {
    if (!t.id || !finite(t.a) || !finite(t.b) || !finite(t.c) || length(cross(sub(t.b, t.a), sub(t.c, t.a))) < 1e-10)
      throw new Error('Invalid visibility triangle');
    return { id: t.id, a: copy(t.a), b: copy(t.b), c: copy(t.c) };
  });
  function build(items: Triangle[]): Node {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of items)
      for (const v of [t.a, t.b, t.c])
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], v[i]);
          max[i] = Math.max(max[i], v[i]);
        }
    if (items.length <= 8) return { min, max, triangles: items };
    const axis = [0, 1, 2].sort((a, b) => max[b] - min[b] - (max[a] - min[a]))[0];
    items.sort((a, b) => a.a[axis] + a.b[axis] + a.c[axis] - (b.a[axis] + b.b[axis] + b.c[axis]));
    const middle = Math.floor(items.length / 2);
    return { min, max, children: [build(items.slice(0, middle)), build(items.slice(middle))] };
  }
  const coverage = input.provenance.coverageBounds;
  if (coverage && !validVolume({ id: 'coverage', ...coverage })) throw new Error('Invalid visibility coverage');
  return {
    provenance: {
      ...input.provenance,
      coverageBounds: coverage ? { min: copy(coverage.min), max: copy(coverage.max) } : undefined,
    },
    root: triangles.length ? build(triangles) : { min: copy(coverage!.min), max: copy(coverage!.max), triangles: [] },
  };
}

function boxIntersection(
  origin: VisibilityVector,
  delta: VisibilityVector,
  box: Pick<Volume, 'min' | 'max'>,
  margin = 0,
): number | null {
  let first = 0,
    last = 1;
  for (let axis = 0; axis < 3; axis++) {
    const min = box.min[axis] - margin,
      max = box.max[axis] + margin;
    if (Math.abs(delta[axis]) < 1e-12) {
      if (origin[axis] < min || origin[axis] > max) return null;
      continue;
    }
    const a = (min - origin[axis]) / delta[axis],
      b = (max - origin[axis]) / delta[axis];
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
    if (first > last) return null;
  }
  return first;
}

function triangleIntersection(origin: VisibilityVector, delta: VisibilityVector, t: Triangle): number | null {
  const e1 = sub(t.b, t.a),
    e2 = sub(t.c, t.a),
    h = cross(delta, e2),
    determinant = dot(e1, h);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant,
    s = sub(origin, t.a),
    u = inverse * dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1),
    v = inverse * dot(delta, q);
  if (v < 0 || u + v > 1) return null;
  const fraction = inverse * dot(e2, q);
  return fraction >= 0 && fraction <= 1 ? fraction : null;
}

function pointTriangleDistance(p: VisibilityVector, t: Triangle): number {
  const ab = sub(t.b, t.a),
    ac = sub(t.c, t.a),
    ap = sub(p, t.a),
    d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = sub(p, t.b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return length(sub(p, addScaled(t.a, ab, d1 / (d1 - d3))));
  const cp = sub(p, t.c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return length(sub(p, addScaled(t.a, ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return length(sub(p, addScaled(t.b, sub(t.c, t.b), (d4 - d3) / (d4 - d3 + d5 - d6))));
  const inverse = 1 / (va + vb + vc);
  return length(sub(p, addScaled(addScaled(t.a, ab, vb * inverse), ac, vc * inverse)));
}

function segmentDistance(p: VisibilityVector, q: VisibilityVector, a: VisibilityVector, b: VisibilityVector): number {
  const d1 = sub(q, p),
    d2 = sub(b, a),
    r = sub(p, a),
    aa = dot(d1, d1),
    ee = dot(d2, d2),
    f = dot(d2, r);
  let s = 0,
    t = 0;
  if (aa <= 1e-20 && ee <= 1e-20) return length(r);
  if (aa <= 1e-20) t = clamp(f / ee);
  else {
    const c = dot(d1, r);
    if (ee <= 1e-20) s = clamp(-c / aa);
    else {
      const bb = dot(d1, d2),
        denominator = aa * ee - bb * bb;
      s = denominator > 1e-20 ? clamp((bb * f - c * ee) / denominator) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-c / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp((bb - c) / aa);
      }
    }
  }
  return length(sub(addScaled(p, d1, s), addScaled(a, d2, t)));
}

/** Low-level geometry intersection only; callers must separately validate map/eye/dynamic provenance. */
export function traceTriangleSegment(input: {
  origin: VisibilityVector;
  target: VisibilityVector;
  triangles: Iterable<Triangle>;
  clearanceUnits: number;
}): VisibilityTrace['rays'][number] {
  const { origin, target, clearanceUnits } = input;
  if (!finite(origin) || !finite(target) || !Number.isFinite(clearanceUnits) || clearanceUnits <= 0)
    return { target, status: 'unknown', reason: 'invalid-input', obstacleId: null, distance: null };
  const delta = sub(target, origin),
    distance = length(delta);
  if (distance < 1e-10) return { target, status: 'unknown', reason: 'invalid-input', obstacleId: null, distance: null };
  let uncertain: string | undefined;
  for (const triangle of input.triangles) {
    if (![triangle.a, triangle.b, triangle.c].every(finite))
      return { target, status: 'unknown', reason: 'invalid-input', obstacleId: triangle.id, distance: null };
    const min = [0, 1, 2].map((axis) =>
      Math.min(triangle.a[axis], triangle.b[axis], triangle.c[axis]),
    ) as unknown as VisibilityVector;
    const max = [0, 1, 2].map((axis) =>
      Math.max(triangle.a[axis], triangle.b[axis], triangle.c[axis]),
    ) as unknown as VisibilityVector;
    if (boxIntersection(origin, delta, { min, max }, clearanceUnits) === null) continue;
    const fraction = triangleIntersection(origin, delta, triangle);
    if (fraction !== null)
      return { target, status: 'blocked', reason: 'occluded', obstacleId: triangle.id, distance: fraction * distance };
    if (
      Math.min(
        pointTriangleDistance(origin, triangle),
        pointTriangleDistance(target, triangle),
        segmentDistance(origin, target, triangle.a, triangle.b),
        segmentDistance(origin, target, triangle.b, triangle.c),
        segmentDistance(origin, target, triangle.c, triangle.a),
      ) <= clearanceUnits
    )
      uncertain = triangle.id;
  }
  return uncertain
    ? { target, status: 'unknown', reason: 'edge-clearance', obstacleId: uncertain, distance: null }
    : { target, status: 'clear', reason: 'clear', obstacleId: null, distance };
}

function traceRay(input: TraceInput | GunlineInput, target: VisibilityVector): VisibilityTrace['rays'][number] {
  const origin = input.viewer.eye,
    delta = sub(target, origin),
    distance = length(delta);
  let hit: { id: string; fraction: number } | null = null;
  let uncertain: { id: string; reason: Reason } | null = null;
  const stack = [input.geometry.root];
  while (stack.length) {
    const node = stack.pop() as Node;
    if (boxIntersection(origin, delta, node, input.clearanceUnits) === null) continue;
    if (node.children) {
      stack.push(...node.children);
      continue;
    }
    for (const t of node.triangles ?? []) {
      const fraction = triangleIntersection(origin, delta, t);
      if (fraction !== null) {
        if (!hit || fraction < hit.fraction) hit = { id: t.id, fraction };
        continue;
      }
      const clearance = Math.min(
        pointTriangleDistance(origin, t),
        pointTriangleDistance(target, t),
        segmentDistance(origin, target, t.a, t.b),
        segmentDistance(origin, target, t.b, t.c),
        segmentDistance(origin, target, t.c, t.a),
      );
      if (clearance <= input.clearanceUnits) uncertain = { id: t.id, reason: 'edge-clearance' };
    }
  }
  for (const box of input.dynamics.opaqueVolumes) {
    const fraction = boxIntersection(origin, delta, box);
    if (fraction !== null) {
      if (!hit || fraction < hit.fraction) hit = { id: box.id, fraction };
    } else if (boxIntersection(origin, delta, box, input.clearanceUnits) !== null)
      uncertain = { id: box.id, reason: 'edge-clearance' };
  }
  for (const box of input.dynamics.unknownVolumes)
    if (boxIntersection(origin, delta, box, input.clearanceUnits) !== null)
      uncertain = { id: box.id, reason: 'dynamic-uncertain' };
  if (hit)
    return {
      target: copy(target),
      status: 'blocked',
      reason: 'occluded',
      obstacleId: hit.id,
      distance: hit.fraction * distance,
    };
  if (uncertain)
    return {
      target: copy(target),
      status: 'unknown',
      reason: uncertain.reason,
      obstacleId: uncertain.id,
      distance: null,
    };
  return { target: copy(target), status: 'clear', reason: 'clear', obstacleId: null, distance };
}

function hasMapMatch(provenance: Provenance): boolean {
  if (!provenance.mapName || !provenance.sourceFingerprint || provenance.coordinates !== 'source') return false;
  if (provenance.matchType === 'installed-build-matched') {
    const match = provenance.buildMatch;
    // This is an explicitly labelled installed-build match, not a demo map hash.
    return (
      provenance.demoFingerprint === null &&
      match?.demoPatch === 14190 &&
      match.installedPatch === 14190 &&
      match.clientVersion === 2000930 &&
      match.buildId === 25815307
    );
  }
  return provenance.sourceFingerprint === provenance.demoFingerprint;
}

function traceReferences(input: TraceInput | GunlineInput): VisibilityTrace {
  const { provenance } = input.geometry;
  const referenceMode = 'referencePoint' in input.target;
  const points = 'referencePoint' in input.target ? [input.target.referencePoint] : input.target.points;
  function unknown(reason: Reason): VisibilityTrace {
    return { status: 'unknown', reason, rays: [] };
  }
  if (!hasMapMatch(provenance)) return unknown('map-unverified');
  if (!provenance.opaqueCoverageComplete) return unknown('geometry-incomplete');
  if (
    provenance.coordinateErrorUnits !== undefined &&
    (!Number.isFinite(provenance.coordinateErrorUnits) ||
      provenance.coordinateErrorUnits < 0 ||
      input.clearanceUnits <= provenance.coordinateErrorUnits)
  )
    return unknown('geometry-incomplete');
  if (
    provenance.coverageBounds &&
    [input.viewer.eye, ...points].some((point) =>
      point.some(
        (value, axis) =>
          value - input.clearanceUnits < (provenance.coverageBounds as Volume).min[axis] ||
          value + input.clearanceUnits > (provenance.coverageBounds as Volume).max[axis],
      ),
    )
  )
    return unknown('geometry-incomplete');
  if (!input.viewer.eyeCertified) return unknown('eye-unverified');
  if ('referencePoint' in input.target) {
    if (input.target.reference !== 'decoded-eye' || !input.target.referenceCertified) return unknown('eye-unverified');
  } else if (!input.target.pointsCertified) return unknown('body-unverified');
  if (!referenceMode && 'fovCertified' in input.viewer && !input.viewer.fovCertified) return unknown('fov-unverified');
  if (!referenceMode && 'flashClear' in input.viewer && input.viewer.flashClear === null)
    return unknown('flash-unverified');
  if (!input.dynamics.complete) return unknown('dynamic-incomplete');
  const { eye } = input.viewer;
  if (
    !finite(eye) ||
    (!referenceMode &&
      (!('forward' in input.viewer) ||
        !finite(input.viewer.forward) ||
        length(input.viewer.forward) < 1e-10 ||
        !Number.isFinite(input.viewer.horizontalFov) ||
        !Number.isFinite(input.viewer.verticalFov) ||
        input.viewer.horizontalFov <= 0 ||
        input.viewer.horizontalFov >= 180 ||
        input.viewer.verticalFov <= 0 ||
        input.viewer.verticalFov >= 180)) ||
    !Number.isFinite(input.clearanceUnits) ||
    input.clearanceUnits <= 0 ||
    points.length === 0 ||
    points.length > 64 ||
    points.some((p) => !finite(p) || length(sub(p, eye)) < 1e-10) ||
    [...input.dynamics.opaqueVolumes, ...input.dynamics.unknownVolumes].some((v) => !validVolume(v))
  )
    return unknown('invalid-input');
  if (!referenceMode && 'flashClear' in input.viewer && !input.viewer.flashClear)
    return { status: 'blocked', reason: 'flashed', rays: [] };
  const forward = 'forward' in input.viewer ? input.viewer.forward : sub(points[0], eye);
  const direction = unit(forward),
    right = unit(cross(direction, Math.abs(direction[2]) > 0.9999 ? [0, 1, 0] : [0, 0, 1])),
    up = cross(right, direction);
  const rays = points.map((point): VisibilityTrace['rays'][number] => {
    const delta = sub(point, eye),
      ahead = dot(delta, direction);
    if (
      !referenceMode &&
      'horizontalFov' in input.viewer &&
      (ahead <= 0 ||
        (Math.atan2(Math.abs(dot(delta, right)), ahead) * 180) / Math.PI >= input.viewer.horizontalFov / 2 ||
        (Math.atan2(Math.abs(dot(delta, up)), ahead) * 180) / Math.PI >= input.viewer.verticalFov / 2)
    )
      return { target: copy(point), status: 'blocked', reason: 'outside-fov', obstacleId: null, distance: null };
    return traceRay(input, point);
  });
  const clear = rays.find((r) => r.status === 'clear'),
    uncertain = rays.find((r) => r.status === 'unknown');
  return {
    status: clear ? 'clear' : uncertain ? 'unknown' : 'blocked',
    reason: clear ? 'clear' : (uncertain?.reason ?? rays[0].reason),
    rays,
  };
}

export function traceVisibility(input: TraceInput): VisibilityTrace {
  return traceReferences(input);
}

/** An unobstructed segment between decoded eye references, not a body hitbox or rendered-screen claim. */
export function traceGunline(input: GunlineInput): VisibilityTrace {
  return traceReferences(input);
}

type Plane = { normal: VisibilityVector; distance: number };

function volumeCorners(volume: Volume): VisibilityVector[] {
  return Array.from({ length: 8 }, (_, index) => [
    index & 1 ? volume.max[0] : volume.min[0],
    index & 2 ? volume.max[1] : volume.min[1],
    index & 4 ? volume.max[2] : volume.min[2],
  ]);
}

function hullPlanes(points: VisibilityVector[], margin: number): Plane[] {
  const planes: Plane[] = [];
  for (let a = 0; a < points.length; a++)
    for (let b = a + 1; b < points.length; b++)
      for (let c = b + 1; c < points.length; c++) {
        const product = cross(sub(points[b], points[a]), sub(points[c], points[a]));
        if (length(product) < 1e-8) continue;
        let normal = unit(product),
          distance = dot(normal, points[a]);
        const sides = points.map((point) => dot(normal, point) - distance);
        if (sides.some((side) => side > 1e-7) && sides.some((side) => side < -1e-7)) continue;
        if (sides.some((side) => side > 1e-7)) {
          normal = [-normal[0], -normal[1], -normal[2]];
          distance = -distance;
        }
        if (!planes.some((p) => dot(p.normal, normal) > 1 - 1e-10 && Math.abs(p.distance - distance - margin) < 1e-6))
          planes.push({ normal, distance: distance + margin });
      }
  return planes;
}

function polygonIntersectsHull(vertices: VisibilityVector[], planes: Plane[]): boolean {
  let polygon = vertices;
  for (const plane of planes) {
    const output: VisibilityVector[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index],
        b = polygon[(index + 1) % polygon.length];
      const da = dot(plane.normal, a) - plane.distance,
        db = dot(plane.normal, b) - plane.distance;
      if (da <= 1e-8) output.push(a);
      if (da <= 1e-8 !== db <= 1e-8) output.push(addScaled(a, sub(b, a), da / (da - db)));
    }
    polygon = output;
    if (!polygon.length) return false;
  }
  return true;
}

function boxOutsideHull(box: Pick<Volume, 'min' | 'max'>, planes: Plane[]): boolean {
  return planes.some(
    (plane) =>
      dot(plane.normal, [
        plane.normal[0] >= 0 ? box.min[0] : box.max[0],
        plane.normal[1] >= 0 ? box.min[1] : box.max[1],
        plane.normal[2] >= 0 ? box.min[2] : box.max[2],
      ]) >
      plane.distance + 1e-8,
  );
}

// A sufficient, deliberately conservative alternative to certified bone points:
// every segment from the eye to the entire supplied volume must be unobstructed.
// The provider must independently establish that the real body intersects it.
// Eight corner rays alone do not establish this (a central thin pillar can block).
export function traceVisibilityVolume(
  input: Omit<TraceInput, 'target'> & { target: { volume: Volume; containsBodyCertified: boolean } },
): VisibilityTrace {
  const volume = input.target.volume;
  if (!validVolume(volume) || volume.min.some((value, axis) => value >= volume.max[axis]))
    return { status: 'unknown', reason: 'invalid-input', rays: [] };
  const corners = volumeCorners(volume);
  const cornerResult = traceVisibility({
    ...input,
    target: { points: corners, pointsCertified: input.target.containsBodyCertified },
  });
  // Reuse the input gates, but never infer body visibility from corner results.
  if (!cornerResult.rays.length) return cornerResult;
  if (cornerResult.rays.some((ray) => ray.reason === 'outside-fov'))
    return { status: 'unknown', reason: 'outside-fov', rays: cornerResult.rays };
  const planes = hullPlanes([input.viewer.eye, ...corners], input.clearanceUnits);
  if (planes.length < 4) return { status: 'unknown', reason: 'invalid-input', rays: [] };
  const stack = [input.geometry.root];
  while (stack.length) {
    const node = stack.pop() as Node;
    if (boxOutsideHull(node, planes)) continue;
    if (node.children) {
      stack.push(...node.children);
      continue;
    }
    for (const triangle of node.triangles ?? [])
      if (polygonIntersectsHull([triangle.a, triangle.b, triangle.c], planes))
        return {
          status: 'unknown',
          reason: 'volume-occluded',
          rays: [
            {
              target: volume.min,
              status: 'unknown',
              reason: 'volume-occluded',
              obstacleId: triangle.id,
              distance: null,
            },
          ],
        };
  }
  // Plane rejection is a conservative convex-volume broad phase: an overlap
  // that cannot be disproved stays unknown, including enclosed dynamic boxes.
  for (const box of [...input.dynamics.opaqueVolumes, ...input.dynamics.unknownVolumes])
    if (!boxOutsideHull(box, planes))
      return {
        status: 'unknown',
        reason: 'dynamic-uncertain',
        rays: [
          { target: volume.min, status: 'unknown', reason: 'dynamic-uncertain', obstacleId: box.id, distance: null },
        ],
      };
  return { status: 'clear', reason: 'clear', rays: [] };
}

export function findMultipleEnemyExposure(
  frames: ExposureFrame[],
  options: {
    atLeastEnemies: number;
    minimumDurationSeconds: number;
    maximumGapSeconds: number;
    minimumAngleDegrees: number;
  },
): Exposure[] {
  if (
    !Number.isInteger(options.atLeastEnemies) ||
    options.atLeastEnemies < 2 ||
    options.atLeastEnemies > 5 ||
    !Number.isFinite(options.minimumDurationSeconds) ||
    options.minimumDurationSeconds <= 0 ||
    !Number.isFinite(options.maximumGapSeconds) ||
    options.maximumGapSeconds <= 0 ||
    !Number.isFinite(options.minimumAngleDegrees) ||
    options.minimumAngleDegrees < 0 ||
    options.minimumAngleDegrees > 180
  )
    return [];
  const result: Exposure[] = [],
    active = new Map<string, Exposure>();
  function finish(key: string, episode: Exposure) {
    if (episode.samples >= 2 && episode.endSeconds - episode.startSeconds + 1e-9 >= options.minimumDurationSeconds)
      result.push(episode);
    active.delete(key);
  }
  let previousTime = -Infinity,
    previousTick = -1;
  for (const frame of frames) {
    const valid =
      Number.isInteger(frame.tick) &&
      frame.tick > previousTick &&
      Number.isFinite(frame.timeSeconds) &&
      frame.timeSeconds > previousTime &&
      finite(frame.observerEye);
    if (!valid) {
      for (const [key, episode] of active) finish(key, episode);
      continue;
    }
    previousTime = frame.timeSeconds;
    previousTick = frame.tick;
    const enemies = frame.enemies
      .filter(
        (enemy) =>
          enemy.trace.status === 'clear' &&
          enemy.id &&
          finite(enemy.eye) &&
          length(sub(enemy.eye, frame.observerEye)) > 1e-10,
      )
      .toSorted((a, b) => a.id.localeCompare(b.id));
    if (enemies.length > 5 || new Set(enemies.map((e) => e.id)).size !== enemies.length) {
      for (const [key, episode] of active) finish(key, episode);
      continue;
    }
    const candidates = new Map<string, { ids: string[]; angle: number }>();
    for (let mask = 0; mask < 1 << enemies.length; mask++) {
      const chosen = enemies.filter((_, i) => (mask & (1 << i)) !== 0);
      if (chosen.length !== options.atLeastEnemies) continue;
      let angle = 180;
      for (let i = 0; i < chosen.length; i++)
        for (let j = i + 1; j < chosen.length; j++)
          angle = Math.min(
            angle,
            (Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  dot(unit(sub(chosen[i].eye, frame.observerEye)), unit(sub(chosen[j].eye, frame.observerEye))),
                ),
              ),
            ) *
              180) /
              Math.PI,
          );
      if (angle + 1e-9 < options.minimumAngleDegrees) continue;
      const ids = chosen.map((e) => e.id);
      candidates.set(JSON.stringify(ids), { ids, angle });
    }
    for (const [key, episode] of active)
      if (!candidates.has(key) || frame.timeSeconds - episode.endSeconds > options.maximumGapSeconds + 1e-9)
        finish(key, episode);
    for (const [key, candidate] of candidates) {
      const episode = active.get(key);
      if (episode) {
        episode.endTick = frame.tick;
        episode.endSeconds = frame.timeSeconds;
        episode.samples++;
        episode.minimumAngleDegrees = Math.min(episode.minimumAngleDegrees, candidate.angle);
      } else
        active.set(key, {
          startTick: frame.tick,
          endTick: frame.tick,
          startSeconds: frame.timeSeconds,
          endSeconds: frame.timeSeconds,
          enemyIds: candidate.ids,
          minimumAngleDegrees: candidate.angle,
          samples: 1,
        });
    }
  }
  for (const [key, episode] of active) finish(key, episode);
  return result.sort((a, b) => a.startSeconds - b.startSeconds || a.enemyIds.join().localeCompare(b.enemyIds.join()));
}
