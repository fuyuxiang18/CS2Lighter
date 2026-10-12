import { describe, expect, it } from 'vite-plus/test';
import {
  buildVisibilityGeometry,
  traceGunline,
  type VisibilityVector,
} from 'csdm/node/death-review/visibility-geometry';
import {
  decodeVisibilityMeshCache,
  encodeVisibilityMeshCache,
  parseVisibilityGlb,
  selectVisibilityWindow,
  traceVisibilityMeshGunline,
} from 'csdm/node/death-review/visibility-mesh';

function glbFixture(
  options: {
    invalidIndex?: boolean;
    parentTranslation?: boolean;
    sparse?: boolean;
    duplicateNode?: boolean;
    exporter?: string;
  } = {},
) {
  // The unused fourth vertex must never enter the baked triangle or its bounds.
  const binary = Buffer.alloc(56);
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 999, 999, 999].forEach((v, i) => binary.writeFloatLE(v, i * 4));
  [0, 1, options.invalidIndex ? 99 : 2].forEach((v, i) => binary.writeUInt16LE(v, 48 + i * 2));
  const child = { mesh: 0, name: 'triangle' };
  const json = {
    asset: { version: '2.0', generator: options.exporter ?? 'Source 2 Viewer 20.0.0.0' },
    buffers: [{ byteLength: 54 }],
    bufferViews: [
      { byteOffset: 0, byteLength: 48 },
      { byteOffset: 48, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, type: 'VEC3', count: 4, ...(options.sparse ? { sparse: {} } : {}) },
      { bufferView: 1, componentType: 5123, type: 'SCALAR', count: 3 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: options.parentTranslation ? [{ translation: [1, 2, 3], children: [1] }, child] : [child],
    scenes: [{ nodes: options.duplicateNode ? [0, 0] : [0] }],
  };
  const raw = Buffer.from(JSON.stringify(json)),
    jsonBytes = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(jsonBytes);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonBytes.length + binary.length, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonBytes, binHeader, binary]);
}
const provenance = {
  mapName: 'synthetic',
  sourceFingerprint: 'map-a',
  demoFingerprint: 'map-a',
  coordinates: 'source' as const,
  opaqueCoverageComplete: true,
};

describe('VRF mesh baking', () => {
  it('streams packed ray intersections without constructing a regional object BVH', async () => {
    const mesh = parseVisibilityGlb(glbFixture());
    const decoded = decodeVisibilityMeshCache(encodeVisibilityMeshCache(mesh), mesh.sourceAssetHash);
    const request: Parameters<typeof traceVisibilityMeshGunline>[0] = {
      mesh: decoded,
      provenance,
      viewer: { eye: [-10, 10, 10], eyeCertified: true },
      target: { referencePoint: [10, 10, 10], reference: 'decoded-eye', referenceCertified: true },
      dynamics: { complete: true, opaqueVolumes: [], unknownVolumes: [] },
      clearanceUnits: 0.1,
    };
    const before = Buffer.from(decoded.chunks[0].data);
    expect(await traceVisibilityMeshGunline(request)).toMatchObject({ status: 'blocked', reason: 'occluded' });
    request.viewer.eye = [-10, 30, 30];
    request.target.referencePoint = [10, 30, 30];
    expect((await traceVisibilityMeshGunline(request)).status).toBe('clear');
    request.viewer.eye = [-10, 0, 39.4];
    request.target.referencePoint = [10, 0, 39.4];
    expect(await traceVisibilityMeshGunline(request)).toMatchObject({ status: 'unknown', reason: 'edge-clearance' });
    expect(decoded.chunks[0].data.equals(before)).toBe(true);
  });

  it('does not allow the packed tracer to bypass provenance, dynamic bounds or invalid input gates', async () => {
    const request: Parameters<typeof traceVisibilityMeshGunline>[0] = {
      mesh: parseVisibilityGlb(glbFixture()),
      provenance,
      viewer: { eye: [-10, 100, 100], eyeCertified: true },
      target: { referencePoint: [10, 100, 100], reference: 'decoded-eye', referenceCertified: true },
      dynamics: { complete: true, opaqueVolumes: [], unknownVolumes: [] },
      clearanceUnits: 0.1,
    };
    expect((await traceVisibilityMeshGunline(request)).status).toBe('clear');
    expect(
      (await traceVisibilityMeshGunline({ ...request, provenance: { ...provenance, demoFingerprint: 'other' } }))
        .reason,
    ).toBe('map-unverified');
    expect(
      (await traceVisibilityMeshGunline({ ...request, mesh: { ...request.mesh, hasAnimatedNodes: true } })).reason,
    ).toBe('geometry-incomplete');
    expect(
      (
        await traceVisibilityMeshGunline({
          ...request,
          provenance: { ...provenance, coverageBounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
        })
      ).reason,
    ).toBe('geometry-incomplete');
    expect(
      (await traceVisibilityMeshGunline({ ...request, viewer: { ...request.viewer, eye: [NaN, 0, 0] } })).reason,
    ).toBe('invalid-input');
    expect((await traceVisibilityMeshGunline({ ...request, clearanceUnits: 0 })).reason).toBe('invalid-input');
    expect(
      (
        await traceVisibilityMeshGunline({
          ...request,
          dynamics: {
            complete: true,
            opaqueVolumes: [],
            unknownVolumes: [{ id: 'door', min: [-1, 99, 99], max: [1, 101, 101] }],
          },
        })
      ).reason,
    ).toBe('dynamic-uncertain');
  });

  it('agrees with the exact BVH core for multiple chunks, near edges, coplanar and unobstructed rays', async () => {
    const triangles = [
      {
        id: 'first',
        a: [0, 0, 0] as VisibilityVector,
        b: [0, 20, 0] as VisibilityVector,
        c: [0, 0, 20] as VisibilityVector,
      },
      {
        id: 'second',
        a: [5, 30, 30] as VisibilityVector,
        b: [5, 50, 30] as VisibilityVector,
        c: [5, 30, 50] as VisibilityVector,
      },
    ];
    const mesh = {
      sourceAssetHash: 'a'.repeat(64),
      triangleCount: 2,
      maximumRoundingError: 0,
      hasAnimatedNodes: false,
      chunks: triangles.map((triangle) => {
        const data = Buffer.alloc(36);
        [...triangle.a, ...triangle.b, ...triangle.c].forEach((v, i) => data.writeFloatLE(v, i * 4));
        return {
          min: triangle.a,
          max: [triangle.a[0], triangle.b[1], triangle.c[2]] as VisibilityVector,
          label: triangle.id,
          triangleCount: 1,
          compressed: false,
          data,
        };
      }),
    };
    const geometry = buildVisibilityGeometry({ provenance, triangles });
    for (const [origin, target] of [
      [
        [-10, 5, 5],
        [10, 5, 5],
      ],
      [
        [-10, 35, 35],
        [10, 35, 35],
      ],
      [
        [-10, 0, 20.05],
        [10, 0, 20.05],
      ],
      [
        [0, 2, 2],
        [0, 4, 4],
      ],
      [
        [-10, 100, 100],
        [10, 100, 100],
      ],
      [
        [-10, 0, 20.2],
        [10, 0, 20.2],
      ],
    ] as [VisibilityVector, VisibilityVector][]) {
      const request = {
        viewer: { eye: origin, eyeCertified: true },
        target: { referencePoint: target, reference: 'decoded-eye' as const, referenceCertified: true },
        dynamics: { complete: true, opaqueVolumes: [], unknownVolumes: [] },
        clearanceUnits: 0.1,
      };
      const packed = await traceVisibilityMeshGunline({ ...request, mesh, provenance });
      const exact = traceGunline({ ...request, geometry });
      expect({ status: packed.status, reason: packed.reason }).toEqual({ status: exact.status, reason: exact.reason });
    }
  });

  it('yields and responds to cancellation before scanning candidate chunks', async () => {
    const controller = new AbortController();
    const promise = traceVisibilityMeshGunline({
      mesh: parseVisibilityGlb(glbFixture()),
      provenance,
      viewer: { eye: [-10, 10, 10], eyeCertified: true },
      target: { referencePoint: [10, 10, 10], reference: 'decoded-eye', referenceCertified: true },
      dynamics: { complete: true, opaqueVolumes: [], unknownVolumes: [] },
      clearanceUnits: 0.1,
      signal: controller.signal,
    });
    controller.abort(new Error('User canceled'));
    await expect(promise).rejects.toThrow('User canceled');
  });

  it('reads only indexed vertices and maps glTF meters and axes to Source units', () => {
    const mesh = parseVisibilityGlb(glbFixture());
    expect(mesh.triangleCount).toBe(1);
    expect(mesh.chunks[0].data.length).toBe(36);
    expect(mesh.chunks[0].max[0]).toBe(0);
    expect(mesh.chunks[0].max[1]).toBeCloseTo(39.37007874);
    expect(mesh.chunks[0].max[2]).toBeCloseTo(39.37007874);
    expect(mesh.chunks[0].max.every((value) => value < 40)).toBe(true);
  });

  it('composes parent transforms before coordinate conversion', () => {
    const mesh = parseVisibilityGlb(glbFixture({ parentTranslation: true }));
    expect(mesh.chunks[0].min[0]).toBeCloseTo(3 / 0.0254);
    expect(mesh.chunks[0].min[1]).toBeCloseTo(1 / 0.0254);
    expect(mesh.chunks[0].min[2]).toBeCloseTo(2 / 0.0254);
  });

  it('rejects unverified coordinates, sparse input, graph aliasing, bad indices and truncation', () => {
    for (const options of [
      { exporter: 'Other exporter' },
      { sparse: true },
      { invalidIndex: true },
      { duplicateNode: true },
    ])
      expect(() => parseVisibilityGlb(glbFixture(options))).toThrow();
    expect(() => parseVisibilityGlb(glbFixture().subarray(0, -1))).toThrow();
  });

  it('round-trips a compact cache and selects a bounded region', () => {
    const mesh = parseVisibilityGlb(glbFixture()),
      cache = encodeVisibilityMeshCache(mesh),
      decoded = decodeVisibilityMeshCache(cache, mesh.sourceAssetHash);
    expect(decoded.triangleCount).toBe(1);
    expect(decoded.chunks[0].compressed).toBe(true);
    const selected = selectVisibilityWindow(decoded, { min: [-1, -1, -1], max: [1, 41, 41] }, provenance);
    expect(selected.status).toBe('ready');
    if (selected.status === 'ready') {
      expect(selected.triangleCount).toBe(1);
      expect(selected.geometry.provenance.coverageBounds).toEqual({ min: [-1, -1, -1], max: [1, 41, 41] });
      expect(selected.geometry.provenance.coordinateErrorUnits).toBe(mesh.maximumRoundingError * Math.sqrt(3));
    }
    expect(selectVisibilityWindow(decoded, { min: [100, 100, 100], max: [101, 101, 101] }, provenance)).toMatchObject({
      status: 'ready',
      triangleCount: 0,
    });
  });

  it('rejects corrupt, truncated and mismatched source caches', () => {
    const mesh = parseVisibilityGlb(glbFixture()),
      cache = encodeVisibilityMeshCache(mesh),
      corrupt = Buffer.from(cache);
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => decodeVisibilityMeshCache(corrupt, mesh.sourceAssetHash)).toThrow();
    expect(() => decodeVisibilityMeshCache(cache.subarray(0, -1), mesh.sourceAssetHash)).toThrow();
    expect(() => decodeVisibilityMeshCache(cache, '0'.repeat(64))).toThrow();
    const damagedBounds = Buffer.from(cache);
    const boundsOffset = damagedBounds.indexOf('"min":[0,0,0]');
    expect(boundsOffset).toBeGreaterThan(0);
    damagedBounds[boundsOffset + 7] = '9'.charCodeAt(0);
    expect(() => decodeVisibilityMeshCache(damagedBounds, mesh.sourceAssetHash)).toThrow('checksum');
  });

  it('does not mutate GLB input and rejects invalid ranges', () => {
    const bytes = glbFixture(),
      before = Buffer.from(bytes),
      mesh = parseVisibilityGlb(bytes);
    expect(bytes.equals(before)).toBe(true);
    expect(selectVisibilityWindow(mesh, { min: [0, 0, 0], max: [0, 1, 1] }, provenance)).toEqual({
      status: 'unavailable',
      reason: 'invalid-range',
    });
  });
});
