import { describe, expect, it } from 'vite-plus/test';
import { buildAnimationEvidence, decodeAnimationAssetData, decodeAnimationRecipeTopology } from './animation-evidence';
import type { EvidenceAnimationContext } from './animation-evidence';
import type { EvidenceFrame } from './evidence-protocol';

const taskTypes = [
  'CNmCachedPoseWriteTask',
  'CNmSampleTask',
  'CNmScaleTask',
  'CNmReferencePoseTask',
  'CNmTwoBoneIKTask',
  'CNmSnapWeaponTask',
  'CNmCachedPoseReadTask',
  'CNmBlendTask',
  'CNmAdditiveBlendTask',
  'CNmOverlayBlendTask',
  'CNmModelSpaceBlendTask',
  'CNmChainLookatTask',
  'CNmFollowBoneTask',
  'CNmZeroPoseTask',
  'CNmAimCSTask',
  'CNmFootIKTask',
];

function asset(lists: string[][]): string {
  const version = Buffer.alloc(4);
  version.writeUInt32LE(1);
  return Buffer.concat([
    version,
    ...lists.flatMap((names) => {
      const count = Buffer.alloc(4);
      count.writeUInt32LE(names.length);
      return [count, ...names.map((name) => Buffer.from(`${name}\0`, 'utf8'))];
    }),
  ]).toString('base64');
}

function decode(topologyBase64 = '1CGEExLO0IEKyC4gTKdlAQ==') {
  return decodeAnimationRecipeTopology({ patch: 14190, recipeVersion: 3, taskTypes, topologyBase64 });
}

describe('demo animation context', () => {
  it('preserves the recorded resource ordering and separates bone/mask indices', () => {
    expect(decodeAnimationAssetData('test.vnmgraph', asset([['z.vnmclip', 'a.vnmclip']]))).toEqual({
      kind: 'graph',
      version: 1,
      resources: ['z.vnmclip', 'a.vnmclip'],
    });
    expect(decodeAnimationAssetData('test.vnmskel', asset([['root', 'head'], ['UpperBody']]))).toEqual({
      kind: 'skeleton',
      version: 1,
      bones: ['root', 'head'],
      masks: ['UpperBody'],
    });
  });

  it('rejects malformed, truncated, unknown-version and extra asset bytes', () => {
    const valid = Buffer.from(asset([['clip.vnmclip']]), 'base64');
    const future = Buffer.from(valid);
    future.writeUInt32LE(2);
    const badCount = Buffer.from(valid);
    badCount.writeUInt32LE(0xffff_ffff, 4);
    for (const data of [future, badCount, valid.subarray(0, -1), Buffer.concat([valid, Buffer.from([0])])]) {
      expect(() => decodeAnimationAssetData('test.vnmgraph', data.toString('base64'))).toThrow();
    }
    expect(() => decodeAnimationAssetData('test.vnmgraph', '%%%')).toThrow();
    expect(() => decodeAnimationAssetData('test.vmdl', asset([[]]))).toThrow();
  });

  it('decodes an anonymized real 13-task recipe without claiming a reconstructed pose', () => {
    const topology = decode();
    expect(topology.consumedBits).toBe(121);
    expect(topology.tasks).toHaveLength(13);
    expect(topology.tasks[3]).toEqual({ type: 'CNmBlendTask', dependencies: [1, 2] });
    expect(topology.tasks.slice(-2)).toEqual([
      { type: 'CNmAimCSTask', dependencies: [10] },
      { type: 'CNmSnapWeaponTask', dependencies: [11] },
    ]);
    expect(topology).not.toHaveProperty('bones');
    expect(topology).not.toHaveProperty('fullBodyAndClockVerified');
  });

  it('supports the real compact and cached-pose topologies', () => {
    expect(decode('0xAQ4lQG').tasks).toHaveLength(5);
    const cached = decode('5QMAIRwxwiHlBBPCQSkctUI4zYXz4GHxHBnCoRVNG9DFAWXtduE=');
    expect(cached.consumedBits).toBe(304);
    expect(cached.tasks[1]).toEqual({ type: 'CNmCachedPoseWriteTask', dependencies: [0] });
    expect(decode('8xAQEpTmWAo=').tasks[4]).toEqual({ type: 'CNmModelSpaceBlendTask', dependencies: [2, 3] });
  });

  it('rejects future versions and tasks with unknown dependency arity', () => {
    expect(() =>
      decodeAnimationRecipeTopology({ patch: 14191, recipeVersion: 3, taskTypes, topologyBase64: '0xAQ4lQG' }),
    ).toThrow();
    expect(() =>
      decodeAnimationRecipeTopology({ patch: 14190, recipeVersion: 4, taskTypes, topologyBase64: '0xAQ4lQG' }),
    ).toThrow();
    expect(() =>
      decodeAnimationRecipeTopology({
        patch: 14190,
        recipeVersion: 3,
        taskTypes: taskTypes.map((type) => (type === 'CNmAimCSTask' ? 'CNmUnknownTask' : type)),
        topologyBase64: '0xAQ4lQG',
      }),
    ).toThrow();
  });

  it('rejects truncation, cyclic/future dependencies and nonzero padding', () => {
    const valid = Buffer.from('1CGEExLO0IEKyC4gTKdlAQ==', 'base64');
    const padding = Buffer.from(valid);
    padding[padding.length - 1] |= 0x80;
    const invalidDependency = Buffer.from(valid);
    // Task 3's first dependency begins at bit 28; index 15 points forward.
    invalidDependency[3] |= 0xf0;
    for (const bytes of [valid.subarray(0, -1), padding, invalidDependency, Buffer.concat([valid, Buffer.from([0])])]) {
      expect(() => decode(bytes.toString('base64'))).toThrow();
    }
  });
});

function summaryFixture() {
  const context: EvidenceAnimationContext = {
    type: 'animation-context',
    contextId: 1,
    frame: 10,
    tick: 10,
    errors: [],
    taskTypes: taskTypes.map((name, index) => ({ index, name })),
    assets: [
      { index: 0, path: 'example.vnmgraph', dataBase64: asset([['a.vnmclip', 'b.vnmclip']]) },
      { index: 1, path: 'example.vnmskel', dataBase64: asset([['root', 'head'], ['UpperBody']]) },
    ],
  };
  const frame: EvidenceFrame = {
    type: 'frame',
    frame: 10,
    tick: 10,
    serverTick: 10,
    players: [
      {
        id: '1:1',
        steamId: '76561190000000001',
        origin: null,
        eyes: null,
        yaw: null,
        pitch: null,
        velocity: null,
        team: null,
        health: null,
        lifeState: null,
        hull: { mins: null, maxs: null },
        fields: {},
        fieldsComplete: true,
        animation: {
          contextId: 1,
          recipeVersion: 3,
          activeSlot: 8,
          topologyBase64: '1CGEExLO0IEKyC4gTKdlAQ==',
          dynamicBase64: 'AA==',
        },
      },
    ],
    world: { complete: true, upserts: [], removed: [] },
    smokes: { complete: true, upserts: [], removed: [] },
  };
  return { patch: 14190, contexts: [context], frames: [frame], subjectId: '76561190000000001' };
}

describe('animation extraction progress', () => {
  it('reports decoded instructions and the exact remaining custom pose tasks', () => {
    const result = buildAnimationEvidence(summaryFixture());
    expect(result).toMatchObject({
      framesWithRecipe: 1,
      decodedTopologyFrames: 1,
      graphResourceCount: 2,
      boneCount: 2,
      maskCount: 1,
      blockingTasks: ['CNmAimCSTask', 'CNmSnapWeaponTask'],
      reasons: ['animation-pose-execution-unverified', 'animation-shot-clock-unverified'],
    });
  });

  it('does not borrow future or ambiguous contexts', () => {
    const future = summaryFixture();
    future.contexts[0].frame = 11;
    expect(buildAnimationEvidence(future).decodedTopologyFrames).toBe(0);
    const duplicate = summaryFixture();
    duplicate.contexts.push(duplicate.contexts[0]);
    expect(buildAnimationEvidence(duplicate).decodedTopologyFrames).toBe(0);
    const duplicateActor = summaryFixture();
    duplicateActor.frames[0].players.push({ ...duplicateActor.frames[0].players[0], id: '2:2' });
    expect(buildAnimationEvidence(duplicateActor).reasons).toContain('animation-actor-ambiguous');
  });

  it('rejects broken contexts, missing dynamic data and untested recipe versions', () => {
    const invalid = summaryFixture();
    invalid.contexts[0].assets[1].dataBase64 = 'AA==';
    expect(buildAnimationEvidence(invalid)).toMatchObject({
      decodedTopologyFrames: 0,
      boneCount: 0,
      graphResourceCount: 0,
    });
    const missing = summaryFixture();
    missing.frames[0].players[0].animation!.dynamicBase64 = null;
    expect(buildAnimationEvidence(missing).reasons).toContain('animation-recipe-incomplete');
    const future = summaryFixture();
    future.patch = 14191;
    expect(buildAnimationEvidence(future).reasons).toContain('animation-topology-unsupported');
  });

  it('requires a valid active slot even when topology and dynamic bytes are present', () => {
    for (const activeSlot of [null, -1, 32, 1023, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = summaryFixture();
      input.frames[0].players[0].animation!.activeSlot = activeSlot;
      expect(buildAnimationEvidence(input)).toMatchObject({
        decodedTopologyFrames: 0,
        reasons: ['animation-recipe-incomplete'],
      });
    }
    for (const activeSlot of [0, 31]) {
      const input = summaryFixture();
      input.frames[0].players[0].animation!.activeSlot = activeSlot;
      expect(buildAnimationEvidence(input).decodedTopologyFrames).toBe(1);
    }
  });
});
