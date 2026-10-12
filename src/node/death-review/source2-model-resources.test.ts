import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  computeSource2ResourceId,
  createSource2ModelResourceResolver,
  inspectSource2ModelMetadata,
  inspectSource2StaticHullBounds,
  parseSource2KeyValues,
  parseSource2PackageIndex,
  parseSource2ResourceDumpBlocks,
} from './source2-model-resources';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execute }));

const references = [
  ['39E84AF24E14B92D', 'animation/graphs/ui/uimodel.vnmgraph'],
  ['C5111C601E968C98', 'animation/graphs/viewmodel/viewmodel.vnmgraph'],
  ['87CE5FF43C25BA7D', 'animation/graphs/worldmodel/worldmodel.vnmgraph'],
  ['9174AFE96CA9ADA4', 'animation/skeletons/characters/viewmodel.vnmskel'],
  ['A3193FB3BC4AD00A', 'animation/skeletons/characters/worldmodel.vnmskel'],
  ['A071197BA483819D', 'characters/models/ctm_sas/materials/ctm_sas_body.vmat'],
  ['9BD871651B678B51', 'characters/models/ctm_sas/materials/ctm_sas_bodylegs.vmat'],
  ['E42A12FF8823CC45', 'characters/models/ctm_sas/materials/ctm_sas_head_gasmask.vmat'],
  ['83EC7F4D2C9304E1', 'characters/models/ctm_sas/materials/ctm_sas_lenses.vmat'],
  ['EBEFB72CF821BF14', 'characters/models/ctm_sas/sleeve/materials/sleeve_ctm_sas.vmat'],
  ['5EE4B4A7487B3F11', 'characters/models/shared/arms/bare_arms/materials/bare_arm_133.vmat'],
  ['6B1D9D6CB710CB1E', 'characters/models/shared/arms/glove_hardknuckle/materials/glove_hardknuckle_black.vmat'],
  ['96FABEFC048BD9B3', 'materials/models/weapons/w_models/w_eq_defuser/w_eq_defuser.vmat'],
];

function rigidModel() {
  return parseSource2KeyValues(`{
    m_name = "models/test.vmdl" m_modelSkeleton = { m_boneName = [] }
    m_refMeshes = [""] m_refAnimGroups = [] m_refSequenceGroups = []
    m_refAnimIncludeModels = [] m_boneFlexDrivers = [] m_ExtParts = []
  }`);
}
function rigidMesh() {
  return parseSource2KeyValues(`{
    m_sceneObjects = [{ m_vMinBounds = [-1,-2,-3] m_vMaxBounds = [1,2,3] }]
    m_skeleton = { m_bones = [] } m_morphSet = resource:"" m_constraints = []
  }`);
}
function door() {
  const model = rigidModel(),
    mesh = rigidMesh();
  model.m_modelSkeleton = {
    m_boneName: ['root'],
    m_nParent: [-1],
    m_boneScaleParent: [1],
    m_bonePosParent: [[0, 0, 0]],
  };
  mesh.m_skeleton = {
    m_bones: [{ m_boneName: 'root', m_parentName: '', m_invBindPose: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }],
  };
  const animation = parseSource2KeyValues(`{
    m_decoderArray = [{m_szName="CCompressedStaticVector3" m_nVersion=0}, {m_szName="CCompressedAnimQuaternion" m_nVersion=0}, {m_szName="CCompressedStaticFloat" m_nVersion=0}]
    m_segmentArray = [
      {m_nLocalChannel=0 m_container=#[00 00 03 00 01 00 10 00 00 00 00 00 00 00 00 00]},
      {m_nLocalChannel=1 m_container=#[01 00 04 00 01 00 10 00 01 00 3F 6D 3F 6D 3F 6D]},
      {m_nLocalChannel=2 m_container=#[02 00 01 00 01 00 0E 00 02 00 00 00 80 3F]}
    ]
    m_animArray = [{m_flags={m_bDelta=false m_bLegacyWorldspace=false m_bAnimGraphAdditive=false}
      m_pData={m_nFrames=1 m_frameblockArray=[{m_nStartFrame=0 m_nEndFrame=0 m_segmentIndexArray=[0,1,2]}]}
      m_movementArray=[] m_hierarchyArray=[] m_eventArray=[] m_vecRootMin=[0,0,0] m_vecRootMax=[0,0,0]}]
  }`);
  const group = parseSource2KeyValues(`{
    m_localHAnimArray=[""] m_includedGroupArray=[] m_directHSeqGroup="" m_szScripts=[]
    m_decodeKey={m_boneArray=[{m_name="root" m_parent=-1 m_pos=[0,0,0] m_scale=1}]
      m_userArray=[] m_morphArray=[] m_nChannelElements=3 m_dataChannelArray=[
        {m_szChannelClass="BoneChannel" m_szVariableName="Position" m_szElementNameArray=["root"] m_nElementIndexArray=[0]},
        {m_szChannelClass="BoneChannel" m_szVariableName="Angle" m_szElementNameArray=["root"] m_nElementIndexArray=[1]},
        {m_szChannelClass="BoneChannel" m_szVariableName="Scale" m_szElementNameArray=["root"] m_nElementIndexArray=[2]}]}
  }`);
  const sequence = parseSource2KeyValues(`{
    m_localMultiSeqDescArray=[] m_localSynthAnimDescArray=[] m_localCmdSeqDescArray=[]
    m_localScaleSetArray=[] m_localPoseParamArray=[] m_localIKAutoplayLockArray=[]
    m_localS1SeqDescArray=[{m_flags={m_bLegacyDelta=false m_bLegacyWorldspace=false m_bMulti=false m_bPost=false}
      m_autoLayerArray=[] m_IKLockArray=[] m_footMotion=[]
      m_fetch={m_flags={m_b0D=true} m_bCalculatePoseParameters=false m_localReferenceArray=[0]}}]
  }`);
  return { model, mesh, metadata: { animation, group, sequence } };
}
const animatedDump = '-- Block: ANIM Size: 1\n-- Block: AGRP Size: 1\n-- Block: ASEQ Size: 1';

describe('Source 2 resource name mapping and bounded metadata parsing', () => {
  it.each(references)('matches authored RERL id %s', (hex, resource) => {
    expect(computeSource2ResourceId(resource)).toBe(BigInt(`0x${hex}`).toString());
  });
  it.each([
    '../models/a.vmdl',
    '/models/a.vmdl',
    'models\\a.vmdl',
    'MODELS/a.vmdl',
    'models/a.vmdl_c',
    'models//a.vmdl',
  ])('rejects noncanonical names %s', (name) => {
    expect(() => computeSource2ResourceId(name)).toThrow();
  });
  it('preserves uint64, quoted keys, embedded text and binary channel bytes', () => {
    expect(parseSource2KeyValues('{ "test.key" = 18446744073709551615 text = """a\nb""" raw=#[00 FF] }')).toEqual({
      'test.key': '18446744073709551615',
      text: 'a\nb',
      raw: { binaryHex: '00FF' },
    });
  });
  it.each(['{a=#[00X]}', '{a=1 a=2}', '{a=1e999}', '{a=[}', '{a="unterminated}'])(
    'rejects malformed metadata %s',
    (value) => {
      expect(() => parseSource2KeyValues(value)).toThrow();
    },
  );
  it('parses padded CRCs and all occurrences of a metadata block', () => {
    expect(parseSource2PackageIndex('models/a.vmdl_c CRC:00a153a797 size:18022', 'a.vpk')).toEqual([
      { vpkPath: 'a.vpk', path: 'models/a.vmdl_c', crc32: 'a153a797', size: 18022 },
    ]);
    expect(
      parseSource2ResourceDumpBlocks(
        '--- Data for block "MDAT" ---\n{a=1}\n--- Data for block "MDAT" ---\n{a=2}',
        'MDAT',
      ),
    ).toEqual([{ a: 1 }, { a: 2 }]);
    expect(() => parseSource2PackageIndex('models/a.vmdl_c CRC:fffffffff size:1', 'a')).toThrow();
  });
});

describe('authored bounds and bounded single-root animations', () => {
  function physics() {
    return parseSource2KeyValues(`{
      m_bindPose=[] m_boneNames=[] m_bonesHash=[] m_boneParents=[] m_constraints2=[] m_joints=[]
      m_shapeMarkups=[] m_pFeModel=null m_bCompoundsPacked=false
      m_parts=[{m_rnShape={m_spheres=[] m_capsules=[] m_meshes=[] m_compounds=[] m_hulls=[
        {m_Hull={m_Bounds={m_vMinBounds=[-10,-20,-30] m_vMaxBounds=[1,2,3]}}},
        {m_Hull={m_Bounds={m_vMinBounds=[0,0,0] m_vMaxBounds=[10,20,30]}}}]}}]
    }`);
  }
  it('unions static authored physical hulls without presenting them as render bounds', () => {
    expect(inspectSource2StaticHullBounds(physics())).toEqual({ min: [-10, -20, -30], max: [10, 20, 30] });
  });
  it.each(['m_bindPose', 'm_boneNames', 'm_constraints2', 'm_joints', 'm_shapeMarkups', 'm_boneParents'])(
    'rejects transformed or procedural physics: %s',
    (key) => {
      const value = physics();
      value[key] = [1];
      expect(inspectSource2StaticHullBounds(value)).toBeNull();
    },
  );
  it('rejects missing or unsupported physical shapes', () => {
    const value = physics();
    value.m_parts = [{ m_rnShape: { m_hulls: [], m_spheres: [1] } }];
    expect(inspectSource2StaticHullBounds(value)).toBeNull();
  });
  it('unions all meshes and accepts zero-thickness planes', () => {
    const second = rigidMesh();
    second.m_sceneObjects = [{ m_vMinBounds: [0, -4, 0], m_vMaxBounds: [0, 4, 9] }];
    expect(inspectSource2ModelMetadata(rigidModel(), [rigidMesh(), second], '')).toMatchObject({
      boundsKind: 'rigid',
      rigidBounds: { min: [-1, -4, -3], max: [1, 4, 9] },
      blockingReasons: [],
    });
  });
  it.each(['animation', 'morph', 'missing-bounds', 'nonfinite', 'inverted', 'external-parts'] as const)(
    'does not certify %s',
    (reason) => {
      const model = rigidModel(),
        mesh = rigidMesh();
      if (reason === 'morph') mesh.m_morphSet = 'models/morph.vmorf';
      if (reason === 'missing-bounds') mesh.m_sceneObjects = [];
      if (reason === 'nonfinite') mesh.m_sceneObjects = [{ m_vMinBounds: [NaN, 0, 0], m_vMaxBounds: [1, 1, 1] }];
      if (reason === 'inverted') mesh.m_sceneObjects = [{ m_vMinBounds: [2, 0, 0], m_vMaxBounds: [1, 1, 1] }];
      if (reason === 'external-parts') model.m_ExtParts = [{ model: 'other' }];
      expect(
        inspectSource2ModelMetadata(model, [mesh], reason === 'animation' ? animatedDump : '').rigidBounds,
      ).toBeNull();
    },
  );
  it('bounds a real-format one-frame door under every root rotation', () => {
    const { model, mesh, metadata } = door();
    const result = inspectSource2ModelMetadata(model, [mesh], animatedDump, metadata);
    expect(result.boundsKind).toBe('rotation-envelope');
    for (const bound of result.rigidBounds?.max ?? []) expect(bound).toBeCloseTo(Math.sqrt(14), 12);
  });
  it('also bounds a fixed single-root mesh without animations', () => {
    const { model, mesh } = door();
    expect(inspectSource2ModelMetadata(model, [mesh], '').boundsKind).toBe('rotation-envelope');
  });
  it('distinguishes proven physics-only resources from missing mesh metadata', () => {
    const model = rigidModel();
    model.m_refMeshes = [];
    const result = inspectSource2ModelMetadata(model, [], '-- Block: DATA Size: 1\n-- Block: PHYS Size: 2');
    expect(result).toMatchObject({
      resourceHasNoRenderMeshes: true,
      authoredBounds: null,
      rigidBounds: null,
      blockingReasons: [],
    });
    expect(
      inspectSource2ModelMetadata(model, [], '-- Block: DATA Size: 1\n-- Block: MDAT Size: 2')
        .resourceHasNoRenderMeshes,
    ).toBe(false);
    expect(inspectSource2ModelMetadata(rigidModel(), [], '-- Block: DATA Size: 1').resourceHasNoRenderMeshes).toBe(
      false,
    );
  });
  it('applies the inverse bind transform before bounding rotations', () => {
    const { model, mesh, metadata } = door();
    mesh.m_skeleton = {
      m_bones: [{ m_boneName: 'root', m_parentName: '', m_invBindPose: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0] }],
    };
    expect(inspectSource2ModelMetadata(model, [mesh], animatedDump, metadata).rigidBounds?.max[0]).toBeCloseTo(
      Math.hypot(101, 2, 3),
    );
  });
  it.each([
    'translation',
    'scale',
    'extra-bone',
    'graph',
    'sequence-layer',
    'missing-sequence',
    'bad-channel',
    'truncated-channel',
    'missing-animation',
    'multi-frame',
  ] as const)('rejects unsupported animation: %s', (reason) => {
    const { model, mesh, metadata } = door();
    const segments = metadata.animation.m_segmentArray as ReturnType<typeof parseSource2KeyValues>[];
    if (reason === 'translation') segments[0].m_container = { binaryHex: '00000300010010000000003C00000000' };
    if (reason === 'scale') segments[2].m_container = { binaryHex: '0200010001000E00020000000040' };
    if (reason === 'extra-bone') model.m_modelSkeleton = { m_boneName: ['root', 'child'] };
    if (reason === 'graph') model.m_animGraph2Refs = ['graphs/a.vnmgraph'];
    if (reason === 'sequence-layer') metadata.sequence.m_localIKAutoplayLockArray = [1];
    if (reason === 'missing-sequence') metadata.sequence.m_localS1SeqDescArray = [];
    if (reason === 'bad-channel') metadata.group.m_decodeKey = { m_boneArray: [] };
    if (reason === 'truncated-channel') metadata.animation.m_segmentArray = [];
    if (reason === 'multi-frame') {
      const clip = (metadata.animation.m_animArray as ReturnType<typeof parseSource2KeyValues>[])[0];
      (clip.m_pData as ReturnType<typeof parseSource2KeyValues>).m_nFrames = 2;
    }
    expect(
      inspectSource2ModelMetadata(model, [mesh], animatedDump, reason === 'missing-animation' ? undefined : metadata)
        .rigidBounds,
    ).toBeNull();
  });
});

function kv3(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(kv3).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, v]) => `${key}=${kv3(v)}`)
      .join('\n')}}`;
  return JSON.stringify(value);
}
function dump(value: unknown, block = 'DATA') {
  return `--- Data for block "${block}" ---\n${kv3(value)}`;
}

describe('model resolver asset validation and persistent cache', () => {
  let directory: string;
  let modelCrc: string;
  let meshCrc: string;
  let conflictingPackage: boolean;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2lighter-model-test-'));
    modelCrc = '12';
    meshCrc = 'ab';
    conflictingPackage = false;
    execute.mockReset();
    execute.mockImplementation(
      (_file: string, args: string[], _options: unknown, callback: (error: Error | null, output: string) => void) => {
        if (args.includes('-l'))
          return callback(
            null,
            `models/test.vmdl_c CRC:${conflictingPackage && args[1] === 'second.vpk' ? '99' : modelCrc} size:100\nmodels/test.vmesh_c CRC:${meshCrc} size:50`,
          );
        const model = rigidModel();
        model.m_refMeshes = ['models/test.vmesh'];
        callback(null, dump(args[3] === 'models/test.vmdl_c' ? model : rigidMesh()));
      },
    );
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const id = computeSource2ResourceId('models/test.vmdl');
  function options() {
    return {
      vpkPaths: ['test.vpk'],
      vrfExecutablePath: 'fixture-tool',
      cacheDirectory: directory,
      sourceRevision: 'fixture-map-revision',
    };
  }
  function dumps() {
    return execute.mock.calls.filter((call) => !(call[1] as string[]).includes('-l')).length;
  }

  it('reuses one pending read and validates cached results in a fresh resolver', async () => {
    const resolver = createSource2ModelResourceResolver(options());
    const first = await Promise.all([resolver.resolveModel(id), resolver.resolveModel(id)]);
    expect(first[0]).toEqual(first[1]);
    expect(first[0].status).toBe('ready');
    expect(dumps()).toBe(2);
    const second = await createSource2ModelResourceResolver(options()).resolveModel(id);
    expect(second).toEqual(first[0]);
    expect(dumps()).toBe(2);
  });
  it.each(['model-crc', 'mesh-crc', 'source-revision', 'corrupt-cache'] as const)(
    'rebuilds after %s',
    async (change) => {
      await createSource2ModelResourceResolver(options()).resolveModel(id);
      const next = options();
      if (change === 'model-crc') modelCrc = '34';
      if (change === 'mesh-crc') meshCrc = 'cd';
      if (change === 'source-revision') next.sourceRevision = 'new-map';
      if (change === 'corrupt-cache') {
        const files = await fs.readdir(directory);
        await fs.writeFile(path.join(directory, files[0]), '{"version":3}');
      }
      const result = await createSource2ModelResourceResolver(next).resolveModel(id);
      expect(result.status).toBe('ready');
      expect(dumps()).toBe(4);
    },
  );
  it('merges byte-size/CRC-identical package aliases and rejects conflicting resources', async () => {
    const config = { ...options(), vpkPaths: ['test.vpk', 'second.vpk'] };
    expect((await createSource2ModelResourceResolver(config).resolveModel(id)).status).toBe('ready');
    conflictingPackage = true;
    expect(await createSource2ModelResourceResolver(config).resolveModel(id)).toMatchObject({
      status: 'unavailable',
      reason: 'ambiguous-model-resource',
    });
  });
  it('propagates cancellation before doing any metadata work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSource2ModelResourceResolver({ ...options(), signal: controller.signal }).resolveModel(id),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
