import { describe, expect, it, vi } from 'vite-plus/test';
import {
  buildGunlineEvidence,
  transformGunlineModelBounds,
  resolveGunlineEntityBounds,
} from 'csdm/node/death-review/gunline-evidence';
import type { EvidenceFrame, EvidencePlayer, WireField } from 'csdm/node/death-review/evidence-protocol';
import type { Source2ModelResourceResult } from 'csdm/node/death-review/source2-model-resources';

function field(value: unknown): WireField {
  return { present: true, value, lastUpdate: null };
}
function player(id: string, eyes: [number, number, number], team: number, yaw: number): EvidencePlayer {
  return {
    id,
    steamId: id,
    origin: eyes,
    eyes,
    team,
    yaw,
    pitch: 0,
    health: 100,
    lifeState: 0,
    velocity: [0, 0, 0],
    hull: { mins: [-16, -16, 0], maxs: [16, 16, 72] },
    fieldsComplete: true,
    fields: { m_flFlashDuration: field(0) },
  };
}
function input(): Parameters<typeof buildGunlineEvidence>[0] {
  const raw = Buffer.alloc(36);
  [64, 64, 64, 64, 65, 64, 64, 64, 65].forEach((v, i) => raw.writeFloatLE(v, i * 4));
  const targetSteamId = '76561198000000001';
  const frames: EvidenceFrame[] = [10, 11, 12].map((tick) => ({
    type: 'frame',
    tick,
    frame: tick,
    serverTick: tick,
    players: [
      player(targetSteamId, [0, 0, 0], 2, 0),
      player('76561198000000002', [10, 0, 0], 3, 180),
      player('76561198000000003', [0, 10, 0], 3, -90),
    ],
    world: { complete: tick === 10, upserts: [], removed: [] },
    smokes: { complete: tick === 10, upserts: [], removed: [] },
  }));
  const buildMatch = { demoPatch: 14190, installedPatch: 14190, clientVersion: 2000930, buildId: 25815307 };
  return {
    targetSteamId,
    tickrate: 10,
    frames,
    end: {
      type: 'end',
      status: 'ok',
      emittedTicks: 3,
      missingTicks: [],
      duplicateTicks: 0,
      frames: 3,
      shots: 0,
      capabilities: ['environment-model-candidates'],
      unsupportedClasses: {},
    },
    map: {
      status: 'ready',
      mesh: {
        sourceAssetHash: 'a'.repeat(64),
        triangleCount: 1,
        maximumRoundingError: 0,
        hasAnimatedNodes: false,
        chunks: [
          { min: [64, 64, 64], max: [64, 65, 65], label: 'fixture', triangleCount: 1, compressed: false, data: raw },
        ],
      },
      manifest: {
        version: 1,
        mapName: 'de_fixture',
        matchType: 'installed-build-matched',
        buildMatch,
        sourceFingerprint: 'source',
        inventory: { vpkSha256: 'a'.repeat(64), packageIndexSha256: 'b'.repeat(64), files: [] },
        exporter: 'Source 2 Viewer 20',
        sourceAssetHash: 'a'.repeat(64),
        meshBytes: 36,
        triangleCount: 1,
        createdAt: '2026-10-12',
        resourceAudit: { complete: true, checked: 1 },
      },
      provenance: {
        mapName: 'de_fixture',
        sourceFingerprint: 'source',
        demoFingerprint: null,
        matchType: 'installed-build-matched',
        buildMatch,
        coordinates: 'source',
        opaqueCoverageComplete: true,
      },
    },
    resolveEntityBounds: () => Promise.resolve({ status: 'unavailable', reasons: ['fixture-no-bound'] }),
  };
}

describe('environment eye-reference evidence', () => {
  it('returns two continuous 3D lines and direction separately without mutating input', async () => {
    const data = input(),
      before = JSON.stringify(data);
    const result = await buildGunlineEvidence(data);
    expect(result.status).toBe('evaluated');
    expect(result.basis).toBe('environment-eye-reference');
    expect(result.gunlines).toHaveLength(6);
    expect(
      result.gunlines.every((line) => line.status === 'clear' && line.distance === 10 && line.facingOffset === 0),
    ).toBe(true);
    expect(result.exposures).toMatchObject([
      {
        startTick: 10,
        endTick: 12,
        enemyIds: ['76561198000000002', '76561198000000003'],
        minimumAngleDegrees: 90,
        samples: 3,
      },
    ]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('reconstructs model additions/removals and does not equate a conservative bound to opaque geometry', async () => {
    const data = input();
    data.frames[0].world.upserts = [{ id: 'door:1', className: 'CPropDoorRotating', origin: [5, 0, 0], fields: {} }];
    const resolver = vi.fn(() =>
      Promise.resolve({
        status: 'bounded' as const,
        bounds: { min: [4, -1, -1] as const, max: [6, 1, 1] as const },
        source: 'fixture',
      }),
    );
    data.resolveEntityBounds = resolver;
    data.frames[2].world.removed = ['door:1'];
    const result = await buildGunlineEvidence(data);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(
      result.gunlines.filter((line) => line.enemySteamId === '76561198000000002').map((line) => line.status),
    ).toEqual(['unknown', 'unknown', 'clear']);
    expect(result.exposures).toEqual([]);
    expect(result.status).toBe('partial');
  });

  it('collapses contained pairs/triples into the same four- or five-enemy window', async () => {
    for (const enemies of [4, 5]) {
      const data = input();
      for (const frame of data.frames) {
        for (let index = 3; index <= enemies; index++)
          frame.players.push(player(`7656119800000000${index + 1}`, [5 + index, 5, 0], 3, 180));
      }
      const result = await buildGunlineEvidence(data);
      expect(result.exposures).toHaveLength(1);
      expect(result.exposures[0].enemyIds).toHaveLength(enemies);
      expect(result.exposures[0]).toMatchObject({ startTick: 10, endTick: 12, samples: 3 });
    }
  });

  it('retains a longer pair window extending outside a shorter triple', async () => {
    const data = input(),
      baseline = data.frames[0];
    data.frames = [10, 11, 12, 13, 14].map((tick) => ({
      ...baseline,
      tick,
      frame: tick,
      players: [...baseline.players],
      world: { complete: tick === 10, upserts: [], removed: [] },
      smokes: { complete: tick === 10, upserts: [], removed: [] },
    }));
    for (const frame of data.frames.slice(1, 4)) frame.players.push(player('76561198000000004', [8, 8, 0], 3, 180));
    data.end.emittedTicks = 5;
    data.end.frames = 5;
    const result = await buildGunlineEvidence(data);
    expect(result.exposures).toMatchObject([
      { startTick: 10, endTick: 14, enemyIds: ['76561198000000002', '76561198000000003'] },
      { startTick: 11, endTick: 13, enemyIds: ['76561198000000002', '76561198000000003', '76561198000000004'] },
    ]);
  });

  it('keeps smoke deltas active until removed, while an undetonated projectile does not obscure the map', async () => {
    const data = input();
    data.frames[0].smokes.upserts = [
      {
        id: 'smoke:1',
        className: 'CSmokeGrenadeProjectile',
        origin: [99, 99, 99],
        fields: { m_bDidSmokeEffect: field(true) },
        declaredSize: 800,
        update: 1,
        frameDataBase64: 'AA==',
      },
    ];
    data.frames[2].smokes.removed = ['smoke:1'];
    const active = await buildGunlineEvidence(data);
    expect(active.gunlines.map((line) => line.status)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'clear',
      'clear',
    ]);
    data.frames[0].smokes.upserts[0].fields.m_bDidSmokeEffect = field(false);
    data.frames[0].smokes.upserts[0].declaredSize = 0;
    expect((await buildGunlineEvidence(data)).status).toBe('evaluated');
  });

  it('rejects missing candidate coverage, unsupported classes, missing baselines and unbounded props', async () => {
    for (const kind of ['coverage', 'class', 'baseline', 'prop'] as const) {
      const data = input();
      if (kind === 'coverage') delete data.end.capabilities;
      if (kind === 'class') data.end.unsupportedClasses = { CFutureMovingWall: 1 };
      if (kind === 'baseline') data.frames[0].world.complete = false;
      if (kind === 'prop')
        data.frames[0].world.upserts = [
          { id: 'unknown:1', className: 'CDynamicProp', origin: [999, 999, 999], fields: {} },
        ];
      const result = await buildGunlineEvidence(data);
      expect(result.status).toBe('unavailable');
      expect(result.exposures).toEqual([]);
    }
  });

  it('excludes only explicitly certified non-rendering resources rather than missing model data', async () => {
    const data = input();
    data.frames[0].world.upserts = [{ id: 'clip:1', className: 'CBaseModelEntity', origin: null, fields: {} }];
    data.resolveEntityBounds = () =>
      Promise.resolve({ status: 'non-rendering', source: 'verified-empty-render-resources' });
    expect((await buildGunlineEvidence(data)).status).toBe('evaluated');
    data.resolveEntityBounds = () => Promise.resolve({ status: 'unavailable', reasons: ['model-missing'] });
    expect((await buildGunlineEvidence(data)).status).toBe('unavailable');
  });

  it('keeps geometry independent of flash effects and breaks continuity across missing frames', async () => {
    const data = input();
    data.frames[1].players[1].fields.m_flFlashDuration = field(2);
    expect((await buildGunlineEvidence(data)).exposures).toHaveLength(1);
    const gap = input();
    gap.frames.splice(1, 1);
    gap.end.missingTicks = [11];
    expect((await buildGunlineEvidence(gap)).exposures).toEqual([]);
  });

  it('conservatively transforms all authored model corners and rejects attached/unknown transforms', () => {
    const entity = {
      id: 'rigid:1',
      className: 'CPhysicsPropMultiplayer',
      origin: [100, 200, 300] as [number, number, number],
      fields: {
        'CBodyComponent.m_skeletonInstance.m_angRotation': field([0, 90, 0]),
        'CBodyComponent.m_skeletonInstance.m_flScale': field(2),
        'CBodyComponent.m_skeletonInstance.m_hParent': field(16777215),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_x': field(0),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_y': field(0),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_z': field(0),
      },
    };
    const result = transformGunlineModelBounds(entity, { min: [-1, -2, -3], max: [1, 2, 3] });
    expect(result).toMatchObject({
      status: 'bounded',
      bounds: { min: [95.99, 197.99, 293.99], max: [104.01, 202.01, 306.01] },
    });
    expect(transformGunlineModelBounds(entity, { min: [-1, -2, -3], max: [1, 2, 3] }, 'water-volume')).toMatchObject({
      status: 'bounded',
      source: 'water-volume',
    });
    entity.fields['CBodyComponent.m_skeletonInstance.m_hParent'] = field(123);
    expect(transformGunlineModelBounds(entity, { min: [-1, -2, -3], max: [1, 2, 3] }).status).toBe('unavailable');
  });

  it('certifies empty base models separately from verified water volumes and dynamic animation envelopes', () => {
    const model: Extract<Source2ModelResourceResult, { status: 'ready' }> = {
      status: 'ready',
      modelId: '123',
      resourcePath: 'synthetic.vmdl',
      metadataFingerprint: 'a'.repeat(64),
      authoredBounds: null,
      rigidBounds: null,
      boundsKind: null,
      resourceHasNoRenderMeshes: true,
      meshCount: 0,
      blockingReasons: [],
    };
    const entity = {
      id: 'volume:1',
      className: 'CBaseModelEntity',
      origin: [100, 200, 300] as [number, number, number],
      fields: {
        'CBodyComponent.m_skeletonInstance.m_angRotation': field([0, 0, 0]),
        'CBodyComponent.m_skeletonInstance.m_flScale': field(1),
        'CBodyComponent.m_skeletonInstance.m_hParent': field(16777215),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_x': field(0),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_y': field(0),
        'CBodyComponent.m_skeletonInstance.m_modelState.m_flRootBoneOffset_z': field(0),
        'm_Collision.m_vecMins': field([-1, -2, -3]),
        'm_Collision.m_vecMaxs': field([1, 2, 3]),
      } as Record<string, WireField>,
    };
    expect(resolveGunlineEntityBounds(entity, model)).toMatchObject({ status: 'non-rendering' });
    entity.className = 'CFuncWater';
    expect(resolveGunlineEntityBounds(entity, model)).toMatchObject({ status: 'unavailable' });
    model.physicsBounds = { min: [-1, -2, -3], max: [1, 2, 3] };
    expect(resolveGunlineEntityBounds(entity, model)).toMatchObject({
      status: 'bounded',
      source: 'water-volume',
      bounds: { min: [98.99, 197.99, 296.99], max: [101.01, 202.01, 303.01] },
    });
    entity.fields['m_Collision.m_vecMaxs'] = field([1, 2, 4]);
    expect(resolveGunlineEntityBounds(entity, model)).toMatchObject({
      status: 'unavailable',
      reasons: ['water-physics-volume-unverified'],
    });
    entity.className = 'CFuncBrush';
    expect(resolveGunlineEntityBounds(entity, model).status).toBe('unavailable');
    model.resourceHasNoRenderMeshes = false;
    model.rigidBounds = { min: [-1, -2, -3], max: [1, 2, 3] };
    model.boundsKind = 'rotation-envelope';
    expect(resolveGunlineEntityBounds(entity, model).status).toBe('unavailable');
    entity.fields['CBodyComponent.m_animationController.m_hGraphDefinitionAG2'] = field('0');
    expect(resolveGunlineEntityBounds(entity, model)).toMatchObject({
      status: 'bounded',
      source: 'authored-rigid-render-bounds',
    });
    entity.fields['CBodyComponent.m_animationController.m_hGraphDefinitionAG2'] = field('100');
    expect(resolveGunlineEntityBounds(entity, model).status).toBe('unavailable');
    entity.fields['CBodyComponent.m_animationController.m_hGraphDefinitionAG2'] = field('0');
    entity.fields.m_bClientSideRagdoll = field(true);
    expect(resolveGunlineEntityBounds(entity, model).status).toBe('unavailable');
  });
});
