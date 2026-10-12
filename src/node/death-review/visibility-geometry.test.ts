import { describe, expect, it } from 'vite-plus/test';
import {
  buildVisibilityGeometry,
  findMultipleEnemyExposure,
  traceGunline,
  traceVisibility,
  traceVisibilityVolume,
  type VisibilityTrace,
  type VisibilityVector,
} from 'csdm/node/death-review/visibility-geometry';

function scene() {
  return {
    geometry: buildVisibilityGeometry({
      provenance: {
        mapName: 'synthetic',
        sourceFingerprint: 'mesh-a',
        demoFingerprint: 'mesh-a',
        coordinates: 'source',
        opaqueCoverageComplete: true,
      },
      triangles: [{ id: 'wall', a: [5, 2, -2], b: [5, 6, -2], c: [5, 2, 2] }],
    }),
    viewer: {
      eye: [0, 0, 0] as VisibilityVector,
      forward: [1, 0, 0] as VisibilityVector,
      horizontalFov: 120,
      verticalFov: 90,
      eyeCertified: true,
      fovCertified: true,
      flashClear: true as boolean | null,
    },
    target: { points: [[10, 0, 0] as VisibilityVector], pointsCertified: true },
    dynamics: {
      complete: true,
      opaqueVolumes: [] as { id: string; min: VisibilityVector; max: VisibilityVector }[],
      unknownVolumes: [] as { id: string; min: VisibilityVector; max: VisibilityVector }[],
    },
    clearanceUnits: 0.1,
  };
}

describe('certified offline visibility', () => {
  it('traces clear and blocked rays and reports the real obstacle distance', () => {
    const input = scene();
    expect(traceVisibility(input).status).toBe('clear');
    input.target.points = [[10, 6, 0]];
    const blocked = traceVisibility(input);
    expect(blocked.status).toBe('blocked');
    expect(blocked.rays[0].obstacleId).toBe('wall');
    expect(blocked.rays[0].distance).toBeCloseTo(Math.sqrt(34));
  });

  it('never produces clear when certification, version binding or coverage is missing', () => {
    const mutations = [
      (v: ReturnType<typeof scene>) => {
        v.geometry.provenance.demoFingerprint = 'other';
      },
      (v: ReturnType<typeof scene>) => {
        v.geometry.provenance.opaqueCoverageComplete = false;
      },
      (v: ReturnType<typeof scene>) => {
        v.viewer.eyeCertified = false;
      },
      (v: ReturnType<typeof scene>) => {
        v.viewer.fovCertified = false;
      },
      (v: ReturnType<typeof scene>) => {
        v.viewer.flashClear = null;
      },
      (v: ReturnType<typeof scene>) => {
        v.target.pointsCertified = false;
      },
      (v: ReturnType<typeof scene>) => {
        v.dynamics.complete = false;
      },
    ];
    for (const mutate of mutations) {
      const input = scene();
      mutate(input);
      expect(traceVisibility(input).status).toBe('unknown');
    }
  });

  it('treats conservative smoke or door bounds as unknown and known opaque volumes as blocked', () => {
    const input = scene(),
      box = { id: 'smoke', min: [4, -1, -1] as VisibilityVector, max: [6, 1, 1] as VisibilityVector };
    input.dynamics.unknownVolumes = [box];
    expect(traceVisibility(input)).toMatchObject({ status: 'unknown', reason: 'dynamic-uncertain' });
    input.dynamics.unknownVolumes = [];
    input.dynamics.opaqueVolumes = [box];
    expect(traceVisibility(input).rays[0]).toMatchObject({ status: 'blocked', obstacleId: 'smoke', distance: 4 });
    input.dynamics.opaqueVolumes = [{ ...box, min: [4, 2, -1], max: [6, 3, 1] }];
    expect(traceVisibility(input).status).toBe('clear');
  });

  it('does not call a near-edge or coplanar ray clear', () => {
    const input = scene();
    input.target.points = [[10, 3.98, 0]];
    expect(traceVisibility(input)).toMatchObject({ status: 'unknown', reason: 'edge-clearance' });
    input.viewer.eye = [4.95, 2.2, -1];
    input.viewer.forward = [0, 1, 0];
    input.target.points = [[4.95, 3, -1]];
    expect(traceVisibility(input).status).toBe('unknown');
  });

  it('checks horizontal and vertical FOV, rear angles, flash and invalid inputs', () => {
    const input = scene();
    for (const point of [
      [-10, 0, 0],
      [10, 30, 0],
      [10, 0, 30],
    ] as VisibilityVector[]) {
      input.target.points = [point];
      expect(traceVisibility(input)).toMatchObject({ status: 'blocked', reason: 'outside-fov' });
    }
    input.target.points = [[10, 0, 0]];
    input.viewer.flashClear = false;
    expect(traceVisibility(input).reason).toBe('flashed');
    input.viewer.flashClear = true;
    input.target.points = [[NaN, 0, 0]];
    expect(traceVisibility(input).reason).toBe('invalid-input');
  });

  it('one certified clear body point is enough, but unknown points cannot substitute', () => {
    const input = scene();
    input.target.points = [
      [10, 6, 0],
      [10, 0, 0],
    ];
    expect(traceVisibility(input).status).toBe('clear');
    input.target.pointsCertified = false;
    expect(traceVisibility(input).status).toBe('unknown');
  });

  it('builds a multi-node BVH without mutating caller data or trusting later mutations', () => {
    const input = scene(),
      provenance = { ...input.geometry.provenance };
    const triangles = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      a: [5 + index, 2, -2] as VisibilityVector,
      b: [5 + index, 6, -2] as VisibilityVector,
      c: [5 + index, 2, 2] as VisibilityVector,
    }));
    const original = JSON.stringify(triangles);
    input.geometry = buildVisibilityGeometry({ provenance, triangles });
    expect(JSON.stringify(triangles)).toBe(original);
    provenance.demoFingerprint = 'other';
    triangles[0].a = [0, 0, 0];
    expect(traceVisibility(input).status).toBe('clear');
    input.target.points = [[10, 6, 0]];
    expect(traceVisibility(input).rays[0].obstacleId).toBe('0');
    expect(() => buildVisibilityGeometry({ provenance, triangles: [] })).toThrow();
    expect(() =>
      buildVisibilityGeometry({ provenance, triangles: [{ id: 'bad', a: [0, 0, 0], b: [0, 0, 0], c: [1, 0, 0] }] }),
    ).toThrow();
  });

  it('requires a filtered region to cover the whole ray including clearance', () => {
    const input = scene();
    input.geometry.provenance.coverageBounds = { min: [-1, -2, -2], max: [11, 2, 2] };
    expect(traceVisibility(input).status).toBe('clear');
    input.target.points = [[12, 0, 0]];
    expect(traceVisibility(input).reason).toBe('geometry-incomplete');
    input.target.points = [[10.95, 0, 0]];
    expect(traceVisibility(input).reason).toBe('geometry-incomplete');
    expect(() =>
      buildVisibilityGeometry({
        provenance: input.geometry.provenance,
        triangles: Array(100_001).fill({ id: 'wall', a: [0, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }),
      }),
    ).toThrow('triangle count');
  });

  it('requires clearance larger than the stored coordinate error', () => {
    const input = scene();
    input.geometry.provenance.coordinateErrorUnits = input.clearanceUnits;
    expect(traceVisibility(input).reason).toBe('geometry-incomplete');
    input.geometry.provenance.coordinateErrorUnits = input.clearanceUnits / 2;
    expect(traceVisibility(input).status).toBe('clear');
    input.geometry.provenance.coordinateErrorUnits = NaN;
    expect(traceVisibility(input).reason).toBe('geometry-incomplete');
  });
});

describe('decoded eye-reference gunlines', () => {
  it('traces reference lines behind the viewer without claiming FOV or a body hitbox', () => {
    const input = scene();
    const gunline = {
      geometry: input.geometry,
      viewer: { eye: input.viewer.eye, eyeCertified: true },
      target: {
        referencePoint: [-10, 0, 0] as VisibilityVector,
        reference: 'decoded-eye' as const,
        referenceCertified: true,
      },
      dynamics: input.dynamics,
      clearanceUnits: input.clearanceUnits,
    };
    expect(traceGunline(gunline).status).toBe('clear');
    expect(traceGunline({ ...gunline, target: { ...gunline.target, referenceCertified: false } }).reason).toBe(
      'eye-unverified',
    );
    expect(traceGunline({ ...gunline, dynamics: { ...gunline.dynamics, complete: false } }).reason).toBe(
      'dynamic-incomplete',
    );
  });

  it('accepts only the explicitly mapped installed build and keeps demo fingerprint null', () => {
    const input = scene();
    input.geometry.provenance = {
      ...input.geometry.provenance,
      demoFingerprint: null,
      matchType: 'installed-build-matched',
      buildMatch: { demoPatch: 14190, installedPatch: 14190, clientVersion: 2000930, buildId: 25815307 },
    };
    expect(traceVisibility(input).status).toBe('clear');
    input.geometry.provenance.buildMatch!.demoPatch = 14189;
    expect(traceVisibility(input).reason).toBe('map-unverified');
  });
});

describe('complete target-volume visibility', () => {
  it('rejects a central narrow pillar even when all eight corner rays are clear', () => {
    const input = scene();
    input.geometry = buildVisibilityGeometry({
      provenance: input.geometry.provenance,
      triangles: [{ id: 'thin-pillar', a: [5, -0.1, -0.1], b: [5, 0.1, -0.1], c: [5, 0, 0.1] }],
    });
    const volume = { id: 'body', min: [9, -1, -1] as VisibilityVector, max: [11, 1, 1] as VisibilityVector };
    const corners = Array.from({ length: 8 }, (_, index): VisibilityVector => [
      index & 1 ? 11 : 9,
      index & 2 ? 1 : -1,
      index & 4 ? 1 : -1,
    ]);
    input.target.points = corners;
    expect(traceVisibility(input).rays.every((ray) => ray.status === 'clear')).toBe(true);
    expect(traceVisibilityVolume({ ...input, target: { volume, containsBodyCertified: true } })).toMatchObject({
      status: 'unknown',
      reason: 'volume-occluded',
    });
  });

  it('certifies an entirely unobstructed volume and rejects uncertified body presence', () => {
    const input = scene(),
      target = {
        volume: { id: 'body', min: [9, -1, -1] as VisibilityVector, max: [11, 1, 1] as VisibilityVector },
        containsBodyCertified: true,
      };
    expect(traceVisibilityVolume({ ...input, target }).status).toBe('clear');
    expect(traceVisibilityVolume({ ...input, target: { ...target, containsBodyCertified: false } }).reason).toBe(
      'body-unverified',
    );
    input.dynamics.unknownVolumes = [{ id: 'enclosed-smoke', min: [4, -0.1, -0.1], max: [6, 0.1, 0.1] }];
    expect(traceVisibilityVolume({ ...input, target })).toMatchObject({
      status: 'unknown',
      reason: 'dynamic-uncertain',
    });
  });

  it('does not mistake a wall inside the large eye-to-body AABB but outside the viewing hull for obstruction', () => {
    const input = scene();
    input.geometry = buildVisibilityGeometry({
      provenance: input.geometry.provenance,
      triangles: [{ id: 'outside-cone', a: [1, 0.8, -0.1], b: [1, 0.95, -0.1], c: [1, 0.9, 0.1] }],
    });
    expect(
      traceVisibilityVolume({
        ...input,
        target: { volume: { id: 'body', min: [9, -1, -1], max: [11, 1, 1] }, containsBodyCertified: true },
      }).status,
    ).toBe('clear');
  });
});

const clear: VisibilityTrace = { status: 'clear', reason: 'clear', rays: [] };
const unknown: VisibilityTrace = { status: 'unknown', reason: 'body-unverified', rays: [] };
function frame(timeSeconds: number, ids = ['a', 'b']) {
  return {
    tick: Math.round(timeSeconds * 100),
    timeSeconds,
    observerEye: [0, 0, 0] as VisibilityVector,
    enemies: ids.map((id, index) => ({
      id,
      eye: (index === 0 ? [10, 0, 0] : index === 1 ? [0, 10, 0] : [-10, 0, 0]) as VisibilityVector,
      trace: clear,
    })),
  };
}
const options = { atLeastEnemies: 2, minimumDurationSeconds: 0.2, maximumGapSeconds: 0.11, minimumAngleDegrees: 60 };
describe('continuous simultaneous enemy exposure', () => {
  it('measures an unchanged pair and its angular separation without mutating frames', () => {
    const frames = [frame(1), frame(1.1), frame(1.2)],
      before = JSON.stringify(frames);
    expect(findMultipleEnemyExposure(frames, options)).toEqual([
      {
        startTick: 100,
        endTick: 120,
        startSeconds: 1,
        endSeconds: 1.2,
        enemyIds: ['a', 'b'],
        minimumAngleDegrees: 90,
        samples: 3,
      },
    ]);
    expect(JSON.stringify(frames)).toBe(before);
  });

  it('breaks continuity for unknown, gaps and changing enemies', () => {
    const uncertain = frame(1.1);
    uncertain.enemies[1].trace = unknown;
    expect(findMultipleEnemyExposure([frame(1), uncertain, frame(1.2)], options)).toEqual([]);
    expect(findMultipleEnemyExposure([frame(1), frame(1.2), frame(1.4)], options)).toEqual([]);
    expect(findMultipleEnemyExposure([frame(1), frame(1.1, ['a', 'c']), frame(1.2)], options)).toEqual([]);
  });

  it('requires all three enemies continuously for three-way exposure', () => {
    expect(findMultipleEnemyExposure([frame(1), frame(1.1), frame(1.2)], { ...options, atLeastEnemies: 3 })).toEqual(
      [],
    );
    const result = findMultipleEnemyExposure(
      [frame(1, ['a', 'b', 'c']), frame(1.1, ['a', 'b', 'c']), frame(1.2, ['a', 'b', 'c'])],
      { ...options, atLeastEnemies: 3 },
    );
    expect(result[0].enemyIds).toEqual(['a', 'b', 'c']);
    expect(result[0].minimumAngleDegrees).toBe(90);
  });

  it('rejects invalid times, duplicate opponents and angles below threshold', () => {
    expect(findMultipleEnemyExposure([frame(1), frame(1), frame(1.1)], options)).toEqual([]);
    expect(
      findMultipleEnemyExposure([frame(1, ['a', 'a']), frame(1.1, ['a', 'a']), frame(1.2, ['a', 'a'])], options),
    ).toEqual([]);
    expect(
      findMultipleEnemyExposure([frame(1), frame(1.1), frame(1.2)], { ...options, minimumAngleDegrees: 100 }),
    ).toEqual([]);
  });

  it('does not accumulate increasing timestamps across repeated or reversed demo ticks', () => {
    const repeated = frame(1.1);
    repeated.tick = 100;
    expect(findMultipleEnemyExposure([frame(1), repeated, frame(1.2)], options)).toEqual([]);
    repeated.tick = 99;
    expect(findMultipleEnemyExposure([frame(1), repeated, frame(1.2)], options)).toEqual([]);
  });
});
