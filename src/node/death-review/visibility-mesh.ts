import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { setImmediate } from 'node:timers/promises';
import {
  buildVisibilityGeometry,
  traceGunline,
  traceTriangleSegment,
  type VisibilityTrace,
  type VisibilityVector,
} from 'csdm/node/death-review/visibility-geometry';

// Map baking belongs in a disposable helper, never in the daemon. Buffers retain
// only indexed triangle positions: aggregate fragments share huge accessors.
const MAX_GLB_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_TRIANGLES = 8_000_000;
const CHUNK_TRIANGLES = 4096;
const MAX_CHUNKS = 20_000;
const SOURCE_UNITS_PER_METER = 1 / 0.0254;
type Bounds = { min: VisibilityVector; max: VisibilityVector };
type Chunk = Bounds & { label: string; triangleCount: number; compressed: boolean; data: Buffer };
const rayChunks = new WeakMap<VisibilityMesh, Map<Chunk, Buffer>>();
export type VisibilityMesh = {
  sourceAssetHash: string;
  triangleCount: number;
  maximumRoundingError: number;
  hasAnimatedNodes: boolean;
  chunks: Chunk[];
};
type Accessor = {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
  sparse?: unknown;
  normalized?: boolean;
};
type BufferView = { buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number };
type Primitive = { attributes: { POSITION: number }; indices: number; mode?: number };
type GltfNode = {
  name?: string;
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
};
type Gltf = {
  asset: { generator?: string; version: string };
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: BufferView[];
  accessors: Accessor[];
  meshes: { primitives: Primitive[] }[];
  nodes: GltfNode[];
  scenes: { nodes: number[] }[];
  scene?: number;
  animations?: unknown[];
};
type Matrix = number[];
const identity: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid visibility mesh: ${message}`);
}
function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
function validBounds(bounds: Bounds) {
  return (
    bounds.min.length === 3 &&
    bounds.max.length === 3 &&
    bounds.min.every((v, a) => Number.isFinite(v) && Number.isFinite(bounds.max[a]) && v <= bounds.max[a])
  );
}
function overlaps(a: Bounds, b: Bounds) {
  return a.min.every((value, axis) => value <= b.max[axis] && a.max[axis] >= b.min[axis]);
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 16 }, (_, index) => {
    const row = index % 4,
      col = Math.floor(index / 4);
    let value = 0;
    for (let k = 0; k < 4; k++) value += a[k * 4 + row] * b[col * 4 + k];
    return value;
  });
}
function nodeMatrix(node: GltfNode): Matrix {
  if (node.matrix) {
    requireValue(!node.translation && !node.rotation && !node.scale, 'matrix plus TRS');
    requireValue(node.matrix.length === 16 && node.matrix.every(Number.isFinite), 'node matrix');
    requireValue(
      [3, 7, 11].every((i) => Math.abs(node.matrix?.[i] ?? 1) < 1e-8) && Math.abs(node.matrix[15] - 1) < 1e-8,
      'projective node',
    );
    return node.matrix;
  }
  const p = node.translation ?? [0, 0, 0],
    s = node.scale ?? [1, 1, 1],
    q = node.rotation ?? [0, 0, 0, 1];
  requireValue(
    p.length === 3 && s.length === 3 && q.length === 4 && [...p, ...s, ...q].every(Number.isFinite),
    'node TRS',
  );
  const magnitude = Math.hypot(...q);
  requireValue(Math.abs(magnitude - 1) < 1e-4, 'rotation quaternion');
  const [x, y, z, w] = q.map((v) => v / magnitude);
  return [
    (1 - 2 * (y * y + z * z)) * s[0],
    2 * (x * y + z * w) * s[0],
    2 * (x * z - y * w) * s[0],
    0,
    2 * (x * y - z * w) * s[1],
    (1 - 2 * (x * x + z * z)) * s[1],
    2 * (y * z + x * w) * s[1],
    0,
    2 * (x * z + y * w) * s[2],
    2 * (y * z - x * w) * s[2],
    (1 - 2 * (x * x + y * y)) * s[2],
    0,
    p[0],
    p[1],
    p[2],
    1,
  ];
}
function sourcePosition(p: VisibilityVector, matrix: Matrix): VisibilityVector {
  const v = [0, 1, 2].map(
    (axis) => matrix[axis] * p[0] + matrix[4 + axis] * p[1] + matrix[8 + axis] * p[2] + matrix[12 + axis],
  );
  return [v[2] * SOURCE_UNITS_PER_METER, v[0] * SOURCE_UNITS_PER_METER, v[1] * SOURCE_UNITS_PER_METER];
}
function nonDegenerate(points: VisibilityVector[]) {
  const a = points[1].map((v, i) => v - points[0][i]),
    b = points[2].map((v, i) => v - points[0][i]);
  return Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) >= 1e-10;
}

export function parseVisibilityGlb(input: Uint8Array): VisibilityMesh {
  requireValue(input.byteLength >= 28 && input.byteLength <= MAX_GLB_BYTES, 'GLB size');
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  requireValue(
    bytes.readUInt32LE() === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length,
    'GLB header',
  );
  const jsonLength = bytes.readUInt32LE(12),
    binaryHeader = 20 + jsonLength;
  requireValue(
    bytes.readUInt32LE(16) === 0x4e4f534a && jsonLength <= MAX_HEADER_BYTES && binaryHeader + 8 <= bytes.length,
    'GLB JSON chunk',
  );
  const gltf = JSON.parse(bytes.toString('utf8', 20, binaryHeader)) as Gltf;
  requireValue(
    gltf.asset?.version === '2.0' && gltf.asset.generator?.startsWith('Source 2 Viewer 20.'),
    'unverified exporter coordinates',
  );
  requireValue(
    bytes.readUInt32LE(binaryHeader + 4) === 0x004e4942 &&
      bytes.readUInt32LE(binaryHeader) + binaryHeader + 8 === bytes.length,
    'GLB binary chunk',
  );
  const binary = bytes.subarray(binaryHeader + 8);
  requireValue(
    gltf.buffers?.length === 1 && !gltf.buffers[0].uri && gltf.buffers[0].byteLength <= binary.length,
    'external buffer',
  );
  requireValue(
    Array.isArray(gltf.nodes) &&
      gltf.nodes.length <= 100_000 &&
      Array.isArray(gltf.meshes) &&
      Array.isArray(gltf.accessors) &&
      Array.isArray(gltf.bufferViews),
    'GLB arrays',
  );
  function accessor(index: number, position: boolean) {
    requireValue(Number.isInteger(index), 'accessor index');
    const a = gltf.accessors[index];
    requireValue(a && !a.sparse && !a.normalized && a.type === (position ? 'VEC3' : 'SCALAR'), 'accessor shape');
    requireValue(
      position ? a.componentType === 5126 : [5121, 5123, 5125].includes(a.componentType),
      'accessor component',
    );
    const view = gltf.bufferViews[a.bufferView];
    requireValue(view && (view.buffer ?? 0) === 0, 'buffer view');
    const width = position ? 3 : 1,
      component = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = view.byteStride ?? width * component;
    requireValue(
      Number.isInteger(a.count) &&
        a.count >= 0 &&
        Number.isInteger(offset) &&
        offset >= 0 &&
        Number.isInteger(stride) &&
        stride >= width * component &&
        stride <= 256,
      'accessor bounds',
    );
    const end = (a.byteOffset ?? 0) + (a.count === 0 ? 0 : (a.count - 1) * stride + width * component);
    requireValue(
      end <= view.byteLength && (view.byteOffset ?? 0) + view.byteLength <= gltf.buffers[0].byteLength,
      'truncated accessor',
    );
    return {
      count: a.count,
      get(i: number, axis = 0) {
        requireValue(Number.isInteger(i) && i >= 0 && i < a.count, 'vertex index');
        const address = offset + i * stride + axis * component;
        return position
          ? binary.readFloatLE(address)
          : component === 1
            ? binary.readUInt8(address)
            : component === 2
              ? binary.readUInt16LE(address)
              : binary.readUInt32LE(address);
      },
    };
  }
  const result: VisibilityMesh = {
    sourceAssetHash: hash(bytes),
    triangleCount: 0,
    maximumRoundingError: 0,
    hasAnimatedNodes: Boolean(gltf.animations?.length),
    chunks: [],
  };
  const visited = new Set<number>(),
    active = new Set<number>();
  function visit(index: number, parent: Matrix, depth: number) {
    requireValue(
      Number.isInteger(index) &&
        index >= 0 &&
        index < gltf.nodes.length &&
        depth <= 64 &&
        !active.has(index) &&
        !visited.has(index),
      'node graph',
    );
    active.add(index);
    visited.add(index);
    const node = gltf.nodes[index],
      matrix = multiply(parent, nodeMatrix(node));
    if (node.skin !== undefined) result.hasAnimatedNodes = true;
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      requireValue(mesh && Array.isArray(mesh.primitives), 'mesh');
      for (let pi = 0; pi < mesh.primitives.length; pi++) {
        const primitive = mesh.primitives[pi];
        requireValue((primitive.mode ?? 4) === 4 && primitive.attributes, 'non-triangle primitive');
        const positions = accessor(primitive.attributes.POSITION, true),
          indices = accessor(primitive.indices, false);
        requireValue(
          indices.count % 3 === 0 && result.triangleCount + indices.count / 3 <= MAX_TRIANGLES,
          'triangle count',
        );
        let raw = Buffer.allocUnsafe(CHUNK_TRIANGLES * 36),
          count = 0;
        let min: [number, number, number] = [Infinity, Infinity, Infinity],
          max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        function flush() {
          if (!count) return;
          result.chunks.push({
            min,
            max,
            label: `${index}:${pi}:${result.triangleCount}:${(node.name ?? '').slice(0, 256)}`,
            triangleCount: count,
            compressed: false,
            data: Buffer.from(raw.subarray(0, count * 36)),
          });
          requireValue(result.chunks.length <= MAX_CHUNKS, 'chunk count');
          count = 0;
          raw = Buffer.allocUnsafe(CHUNK_TRIANGLES * 36);
          min = [Infinity, Infinity, Infinity];
          max = [-Infinity, -Infinity, -Infinity];
        }
        for (let ti = 0; ti < indices.count; ti += 3) {
          const points = [0, 1, 2].map((corner) => {
            const vi = indices.get(ti + corner);
            return sourcePosition([positions.get(vi, 0), positions.get(vi, 1), positions.get(vi, 2)], matrix);
          });
          requireValue(
            points.every((p) => p.every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000_000)),
            'nonfinite position',
          );
          if (!nonDegenerate(points)) continue;
          for (let c = 0; c < 3; c++)
            for (let a = 0; a < 3; a++) {
              const value = Math.fround(points[c][a]);
              raw.writeFloatLE(value, count * 36 + c * 12 + a * 4);
              result.maximumRoundingError = Math.max(result.maximumRoundingError, Math.abs(value - points[c][a]));
              min[a] = Math.min(min[a], value);
              max[a] = Math.max(max[a], value);
            }
          count++;
          result.triangleCount++;
          if (count === CHUNK_TRIANGLES) flush();
        }
        flush();
      }
    }
    for (const child of node.children ?? []) visit(child, matrix, depth + 1);
    active.delete(index);
  }
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  requireValue(scene && Array.isArray(scene.nodes), 'default scene');
  for (const root of scene.nodes) visit(root, identity, 0);
  requireValue(result.triangleCount > 0, 'empty mesh');
  return result;
}

export function encodeVisibilityMeshCache(mesh: VisibilityMesh): Buffer {
  const pieces: Buffer[] = [],
    chunks: object[] = [];
  let offset = 0;
  for (const chunk of mesh.chunks) {
    const compressed = chunk.compressed ? chunk.data : deflateSync(chunk.data, { level: 6 });
    chunks.push({
      min: chunk.min,
      max: chunk.max,
      label: chunk.label,
      triangleCount: chunk.triangleCount,
      offset,
      bytes: compressed.length,
      sha256: hash(compressed),
    });
    pieces.push(compressed);
    offset += compressed.length;
    requireValue(offset <= MAX_CACHE_BYTES, 'cache size');
  }
  const header = Buffer.from(
    JSON.stringify({
      version: 1,
      sourceAssetHash: mesh.sourceAssetHash,
      triangleCount: mesh.triangleCount,
      maximumRoundingError: mesh.maximumRoundingError,
      hasAnimatedNodes: mesh.hasAnimatedNodes,
      chunks,
    }),
  );
  requireValue(header.length <= MAX_HEADER_BYTES && offset + header.length + 44 <= MAX_CACHE_BYTES, 'cache header');
  const prefix = Buffer.alloc(12);
  prefix.write('LTVMESH1');
  prefix.writeUInt32LE(header.length, 8);
  const body = Buffer.concat([prefix, header, ...pieces]);
  return Buffer.concat([body, createHash('sha256').update(body).digest()]);
}

export function decodeVisibilityMeshCache(bytes: Buffer, expectedSourceAssetHash: string): VisibilityMesh {
  requireValue(
    bytes.length >= 44 && bytes.length <= MAX_CACHE_BYTES && bytes.toString('ascii', 0, 8) === 'LTVMESH1',
    'cache magic/size',
  );
  const bodyLength = bytes.length - 32;
  requireValue(
    createHash('sha256').update(bytes.subarray(0, bodyLength)).digest().equals(bytes.subarray(bodyLength)),
    'cache checksum',
  );
  const headerLength = bytes.readUInt32LE(8);
  requireValue(headerLength <= MAX_HEADER_BYTES && 12 + headerLength <= bodyLength, 'cache header size');
  const h = JSON.parse(bytes.toString('utf8', 12, 12 + headerLength)) as {
    version: number;
    sourceAssetHash: string;
    triangleCount: number;
    maximumRoundingError: number;
    hasAnimatedNodes: boolean;
    chunks: (Bounds & { label: string; triangleCount: number; offset: number; bytes: number; sha256: string })[];
  };
  requireValue(
    h.version === 1 && /^[a-f0-9]{64}$/.test(h.sourceAssetHash) && h.sourceAssetHash === expectedSourceAssetHash,
    'cache source revision',
  );
  requireValue(
    Number.isInteger(h.triangleCount) &&
      h.triangleCount > 0 &&
      h.triangleCount <= MAX_TRIANGLES &&
      Number.isFinite(h.maximumRoundingError) &&
      h.maximumRoundingError >= 0 &&
      typeof h.hasAnimatedNodes === 'boolean' &&
      Array.isArray(h.chunks) &&
      h.chunks.length <= MAX_CHUNKS,
    'cache metadata',
  );
  let next = 0,
    total = 0;
  const chunks = h.chunks.map((chunk): Chunk => {
    requireValue(
      validBounds(chunk) &&
        typeof chunk.label === 'string' &&
        chunk.label.length <= 512 &&
        Number.isInteger(chunk.triangleCount) &&
        chunk.triangleCount > 0 &&
        chunk.triangleCount <= CHUNK_TRIANGLES &&
        chunk.offset === next &&
        Number.isInteger(chunk.bytes) &&
        chunk.bytes > 0 &&
        12 + headerLength + next + chunk.bytes <= bodyLength,
      'cache chunk',
    );
    const data = bytes.subarray(12 + headerLength + next, 12 + headerLength + next + chunk.bytes);
    requireValue(hash(data) === chunk.sha256, 'cache chunk hash');
    next += chunk.bytes;
    total += chunk.triangleCount;
    return {
      min: chunk.min,
      max: chunk.max,
      label: chunk.label,
      triangleCount: chunk.triangleCount,
      compressed: true,
      data,
    };
  });
  requireValue(total === h.triangleCount && 12 + headerLength + next === bodyLength, 'cache totals');
  return {
    sourceAssetHash: h.sourceAssetHash,
    triangleCount: total,
    maximumRoundingError: h.maximumRoundingError,
    hasAnimatedNodes: h.hasAnimatedNodes,
    chunks,
  };
}

export function selectVisibilityWindow(
  mesh: VisibilityMesh,
  bounds: Bounds,
  provenance: Parameters<typeof buildVisibilityGeometry>[0]['provenance'],
):
  | { status: 'ready'; geometry: ReturnType<typeof buildVisibilityGeometry>; triangleCount: number }
  | { status: 'unavailable'; reason: 'invalid-range' | 'dense-region' } {
  if (!validBounds(bounds) || bounds.min.some((value, axis) => value >= bounds.max[axis]))
    return { status: 'unavailable', reason: 'invalid-range' };
  const triangles: Parameters<typeof buildVisibilityGeometry>[0]['triangles'] = [];
  for (const chunk of mesh.chunks) {
    if (!overlaps(chunk, bounds)) continue;
    const raw = chunk.compressed ? inflateSync(chunk.data, { maxOutputLength: CHUNK_TRIANGLES * 36 }) : chunk.data;
    requireValue(raw.length === chunk.triangleCount * 36, 'chunk output length');
    for (let ti = 0; ti < chunk.triangleCount; ti++) {
      const points = [0, 1, 2].map((c): VisibilityVector => [
        raw.readFloatLE(ti * 36 + c * 12),
        raw.readFloatLE(ti * 36 + c * 12 + 4),
        raw.readFloatLE(ti * 36 + c * 12 + 8),
      ]);
      requireValue(
        points.every((p) => p.every(Number.isFinite)),
        'cached coordinate',
      );
      const min = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]))) as unknown as VisibilityVector;
      const max = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]))) as unknown as VisibilityVector;
      if (!overlaps({ min, max }, bounds)) continue;
      if (triangles.length === 100_000) return { status: 'unavailable', reason: 'dense-region' };
      if (!nonDegenerate(points)) continue;
      triangles.push({ id: `${chunk.label}:${ti}`, a: points[0], b: points[1], c: points[2] });
    }
  }
  return {
    status: 'ready',
    geometry: buildVisibilityGeometry({
      provenance: {
        ...provenance,
        coverageBounds: bounds,
        coordinateErrorUnits: mesh.maximumRoundingError * Math.sqrt(3),
      },
      triangles,
    }),
    triangleCount: triangles.length,
  };
}

function segmentBoxEntry(origin: VisibilityVector, target: VisibilityVector, bounds: Bounds, margin: number) {
  let first = 0,
    last = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = target[axis] - origin[axis],
      min = bounds.min[axis] - margin,
      max = bounds.max[axis] + margin;
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < min || origin[axis] > max) return null;
      continue;
    }
    const a = (min - origin[axis]) / delta,
      b = (max - origin[axis]) / delta;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
    if (first > last) return null;
  }
  return first;
}

/** Stream only ray-overlapping packed chunks; no full-map or large diagonal-AABB object BVH is built. */
export async function traceVisibilityMeshGunline(
  input: Omit<Parameters<typeof traceGunline>[0], 'geometry'> & {
    mesh: VisibilityMesh;
    provenance: Parameters<typeof buildVisibilityGeometry>[0]['provenance'];
    signal?: AbortSignal;
  },
): Promise<VisibilityTrace> {
  input.signal?.throwIfAborted();
  const origin = input.viewer.eye,
    target = input.target.referencePoint;
  if (
    ![origin, target].every((point) => point.length === 3 && point.every(Number.isFinite)) ||
    !Number.isFinite(input.clearanceUnits) ||
    input.clearanceUnits <= 0
  )
    return { status: 'unknown', reason: 'invalid-input', rays: [] };
  if (input.mesh.hasAnimatedNodes) return { status: 'unknown', reason: 'geometry-incomplete', rays: [] };
  const coverageBounds = {
    min: origin.map((v, a) => Math.min(v, target[a]) - input.clearanceUnits - 1) as unknown as VisibilityVector,
    max: origin.map((v, a) => Math.max(v, target[a]) + input.clearanceUnits + 1) as unknown as VisibilityVector,
  };
  const geometry = buildVisibilityGeometry({
    triangles: [],
    provenance: {
      ...input.provenance,
      coverageBounds: input.provenance.coverageBounds ?? coverageBounds,
      coordinateErrorUnits: input.mesh.maximumRoundingError * Math.sqrt(3),
    },
  });
  const gates = traceGunline({ ...input, geometry });
  if (gates.status !== 'clear') return gates;
  let cache = rayChunks.get(input.mesh);
  if (!cache) {
    cache = new Map();
    rayChunks.set(input.mesh, cache);
  }
  const candidates = input.mesh.chunks
    .map((chunk) => ({ chunk, entry: segmentBoxEntry(origin, target, chunk, input.clearanceUnits) }))
    .filter((candidate) => candidate.entry !== null)
    .sort((a, b) => a.entry! - b.entry!);
  let uncertainty: VisibilityTrace['rays'][number] | undefined;
  let processed = 0,
    chunksProcessed = 0;
  for (const { chunk } of candidates) {
    if (chunksProcessed++ % 8 === 0) {
      await setImmediate();
      input.signal?.throwIfAborted();
    }
    processed += chunk.triangleCount;
    if (processed > 500_000) return { status: 'unknown', reason: 'geometry-incomplete', rays: [] };
    let raw = cache.get(chunk);
    if (!raw) {
      raw = chunk.compressed ? inflateSync(chunk.data, { maxOutputLength: CHUNK_TRIANGLES * 36 }) : chunk.data;
      requireValue(raw.length === chunk.triangleCount * 36, 'chunk output length');
      cache.set(chunk, raw);
      let bytes = 0;
      for (const item of cache.values()) bytes += item.length;
      for (const [key, value] of cache) {
        if (bytes <= 8 * 1024 * 1024) break;
        cache.delete(key);
        bytes -= value.length;
      }
    }
    const bytes = raw;
    function* triangles() {
      for (let ti = 0; ti < chunk.triangleCount; ti++) {
        const point = (corner: number): VisibilityVector => [
          bytes.readFloatLE(ti * 36 + corner * 12),
          bytes.readFloatLE(ti * 36 + corner * 12 + 4),
          bytes.readFloatLE(ti * 36 + corner * 12 + 8),
        ];
        yield { id: `${chunk.label}:${ti}`, a: point(0), b: point(1), c: point(2) };
      }
    }
    const ray = traceTriangleSegment({ origin, target, triangles: triangles(), clearanceUnits: input.clearanceUnits });
    if (ray.status === 'blocked') return { status: 'blocked', reason: ray.reason, rays: [ray] };
    if (ray.status === 'unknown') uncertainty = ray;
  }
  return uncertainty ? { status: 'unknown', reason: uncertainty.reason, rays: [uncertainty] } : gates;
}
