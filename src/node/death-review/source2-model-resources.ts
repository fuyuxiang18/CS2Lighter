import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type Source2ResourceEntry = { vpkPath: string; path: string; crc32: string; size: number };
type Vector = [number, number, number];
export type Source2ModelBounds = { min: Vector; max: Vector };
export type Source2ModelResourceResult =
  | {
      status: 'ready';
      modelId: string;
      resourcePath: string;
      metadataFingerprint: string;
      authoredBounds: Source2ModelBounds | null;
      rigidBounds: Source2ModelBounds | null;
      boundsKind: 'rigid' | 'rotation-envelope' | null;
      /** The resource contains no render meshes; this does not exclude a procedural entity renderer. */
      resourceHasNoRenderMeshes: boolean;
      /** Optional static physical volume, never a substitute for the render bounds. */
      physicsBounds?: Source2ModelBounds | null;
      meshCount: number;
      blockingReasons: string[];
    }
  | { status: 'unavailable'; modelId: string; reason: string };
type ToolOptions = { vrfExecutablePath: string; signal?: AbortSignal };
type KeyValue = null | boolean | number | string | KeyValue[] | { [key: string]: KeyValue };
type KeyObject = { [key: string]: KeyValue };
type MetadataBlock = 'DATA' | 'MDAT' | 'ANIM' | 'AGRP' | 'ASEQ' | 'PHYS';
type AnimationMetadata = { animation: KeyObject; group: KeyObject; sequence: KeyObject };
const MAX_DUMP_BYTES = 16 * 1024 * 1024;

/** Resource names, not contents: VRF's seed and Appleby's original MurmurHash64B. */
export function computeSource2ResourceId(resourcePath: string): string {
  if (!validResourcePath(resourcePath) || resourcePath.endsWith('_c'))
    throw new Error('Invalid Source 2 resource name');
  const bytes = Buffer.from(resourcePath, 'utf8');
  const multiplier = 0x5bd1e995;
  const mix = (value: number) => {
    value = Math.imul(value, multiplier);
    return Math.imul(value ^ (value >>> 24), multiplier) >>> 0;
  };
  let first = (0xedabcdef ^ bytes.length) >>> 0;
  let second = 0;
  let offset = 0;
  for (; offset + 8 <= bytes.length; offset += 8) {
    first = (Math.imul(first, multiplier) ^ mix(bytes.readUInt32LE(offset))) >>> 0;
    second = (Math.imul(second, multiplier) ^ mix(bytes.readUInt32LE(offset + 4))) >>> 0;
  }
  if (offset + 4 <= bytes.length) {
    first = (Math.imul(first, multiplier) ^ mix(bytes.readUInt32LE(offset))) >>> 0;
    offset += 4;
  }
  if (offset < bytes.length) {
    for (let index = offset; index < bytes.length; index++) second ^= bytes[index] << ((index - offset) * 8);
    second = Math.imul(second, multiplier) >>> 0;
  }
  first = Math.imul(first ^ (second >>> 18), multiplier) >>> 0;
  second = Math.imul(second ^ (first >>> 22), multiplier) >>> 0;
  first = Math.imul(first ^ (second >>> 17), multiplier) >>> 0;
  second = Math.imul(second ^ (first >>> 19), multiplier) >>> 0;
  return ((BigInt(first) << 32n) | BigInt(second)).toString();
}

function validResourcePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    /^[a-z0-9_./+@ -]+$/.test(value) &&
    !value.startsWith('/') &&
    !value.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

export function parseSource2PackageIndex(output: string, vpkPath: string): Source2ResourceEntry[] {
  const entries: Source2ResourceEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?) CRC:([0-9a-fA-F]+) size:(\d+)\s*$/.exec(line.trim());
    if (!match) continue;
    const size = Number(match[3]);
    const crc = BigInt(`0x${match[2]}`);
    if (!validResourcePath(match[1]) || !Number.isSafeInteger(size) || size < 0 || crc > 0xffffffffn) {
      throw new Error('Invalid Source 2 package entry');
    }
    entries.push({ vpkPath, path: match[1], crc32: crc.toString(16).padStart(8, '0'), size });
  }
  if (entries.length === 0) throw new Error('Source 2 package index is empty');
  return entries;
}

async function runVrf(options: ToolOptions, args: string[], maxBuffer = MAX_DUMP_BYTES): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(
      options.vrfExecutablePath,
      args,
      {
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        timeout: 45_000,
        maxBuffer,
        signal: options.signal,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function readSource2PackageIndex(options: ToolOptions & { vpkPath: string }) {
  return parseSource2PackageIndex(
    await runVrf(options, ['-i', options.vpkPath, '-l'], 32 * 1024 * 1024),
    options.vpkPath,
  );
}

/** Reads only named metadata blocks; never exports meshes, textures or animations. */
async function readSource2ResourceBlock(
  options: ToolOptions & { entry: Source2ResourceEntry; block: MetadataBlock | 'RERL' },
) {
  return runVrf(options, ['-i', options.entry.vpkPath, '-f', options.entry.path, '-b', options.block]);
}

/** Small, bounded KV3 text reader for VRF's metadata dump; binary payloads remain opaque. */
export function parseSource2KeyValues(text: string): KeyObject {
  if (Buffer.byteLength(text) > MAX_DUMP_BYTES) throw new Error('Source 2 metadata is too large');
  let cursor = 0,
    tokens = 0;
  const skip = () => {
    while (cursor < text.length) {
      if (/\s|,/.test(text[cursor])) cursor++;
      else if (text.startsWith('<!--', cursor)) {
        const end = text.indexOf('-->', cursor + 4);
        if (end < 0) throw new Error('Unclosed KV3 header');
        cursor = end + 3;
      } else break;
    }
  };
  const string = () => {
    if (text.startsWith('"""', cursor)) {
      const start = cursor + 3,
        end = text.indexOf('"""', start);
      if (end < 0) throw new Error('Unclosed KV3 multiline string');
      cursor = end + 3;
      return text.slice(start, end);
    }
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') cursor += 2;
      else if (text[cursor++] === '"') return JSON.parse(text.slice(start, cursor)) as string;
    }
    throw new Error('Unclosed KV3 string');
  };
  const value = (depth: number): KeyValue => {
    if (depth > 64 || ++tokens > 250_000) throw new Error('KV3 metadata exceeds complexity limit');
    skip();
    if (text[cursor] === '"') return string();
    if (text[cursor] === '{') {
      cursor++;
      const result: KeyObject = Object.create(null);
      for (;;) {
        skip();
        if (text[cursor] === '}') {
          cursor++;
          return result;
        }
        const quoted = text[cursor] === '"';
        const key = quoted ? string() : /^[A-Za-z_][A-Za-z_0-9.]*/.exec(text.slice(cursor))?.[0];
        if (!key) throw new Error('Invalid KV3 key');
        if (!quoted) cursor += key.length;
        skip();
        if (text[cursor++] !== '=' || Object.hasOwn(result, key))
          throw new Error('Invalid or duplicate KV3 assignment');
        result[key] = value(depth + 1);
      }
    }
    if (text[cursor] === '[') {
      cursor++;
      const result: KeyValue[] = [];
      for (;;) {
        skip();
        if (text[cursor] === ']') {
          cursor++;
          return result;
        }
        result.push(value(depth + 1));
      }
    }
    if (text.startsWith('#[', cursor)) {
      const end = text.indexOf(']', cursor + 2);
      if (end < 0) throw new Error('Unclosed KV3 binary data');
      const hex = text.slice(cursor + 2, end).replace(/\s/g, '');
      if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Invalid KV3 binary data');
      cursor = end + 1;
      return { binaryHex: hex };
    }
    const token = /^[^\s,\]}]+/.exec(text.slice(cursor))?.[0];
    if (!token) throw new Error('Invalid KV3 value');
    if (token.startsWith('resource:') || token.startsWith('resource_name:')) {
      cursor += token.indexOf(':') + 1;
      skip();
      if (text[cursor] !== '"') throw new Error('Invalid KV3 resource reference');
      return string();
    }
    cursor += token.length;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      const number = Number(token);
      if (!Number.isFinite(number)) throw new Error('Nonfinite KV3 number');
      return Number.isInteger(number) && !Number.isSafeInteger(number) ? token : number;
    }
    throw new Error('Unsupported KV3 value');
  };
  const result = value(0);
  skip();
  if (cursor !== text.length || result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Invalid KV3 document');
  }
  return result;
}

export function parseSource2ResourceDumpBlocks(output: string, block: MetadataBlock): KeyObject[] {
  const sections = output.split(/--- Data for block "([A-Z0-9]+)" ---/);
  const result: KeyObject[] = [];
  for (let index = 1; index < sections.length; index += 2) {
    if (sections[index] !== block) continue;
    const text = sections[index + 1].split(/\r?\n--- (?:Files in package|Resource)/)[0].trim();
    result.push(parseSource2KeyValues(text));
  }
  return result;
}

function object(value: KeyValue | undefined): KeyObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function array(value: KeyValue | undefined): KeyValue[] | null {
  return Array.isArray(value) ? value : null;
}
function vector(value: KeyValue | undefined): Vector | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6)
    ? (value as Vector)
    : null;
}
function nonempty(value: KeyValue | undefined) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

/**
 * The legacy ANIM format is decoded by VRF SequenceAnimation.BuildSegmentArray.
 * Only a single root bone, static zero translation, unit scale, and rotation are
 * accepted. A sphere encloses any rotation, including transitions between clips.
 * This deliberately does not evaluate character animation graphs or arbitrary IK.
 */
function inspectRotationOnlyEnvelope(
  model: KeyObject,
  meshes: KeyObject[],
  bounds: Source2ModelBounds,
  metadata?: AnimationMetadata,
): Source2ModelBounds | null {
  const empty = (value: KeyValue | undefined) => Array.isArray(value) && value.length === 0;
  const one = (value: KeyValue | undefined, expected: KeyValue) =>
    Array.isArray(value) && value.length === 1 && value[0] === expected;
  const zero = (value: KeyValue | undefined) => vector(value)?.every((v) => v === 0) === true;
  const skeleton = object(model.m_modelSkeleton);
  const names = array(skeleton?.m_boneName);
  if (
    !skeleton ||
    names?.length !== 1 ||
    typeof names[0] !== 'string' ||
    !one(skeleton.m_nParent, -1) ||
    !one(skeleton.m_boneScaleParent, 1) ||
    !zero(array(skeleton.m_bonePosParent)?.[0])
  )
    return null;
  if (
    [
      'm_refAnimGroups',
      'm_refSequenceGroups',
      'm_refAnimIncludeModels',
      'm_animGraph2Refs',
      'm_vecNmSkeletonRefs',
    ].some((key) => nonempty(model[key]))
  )
    return null;
  const inverseBinds: number[][] = [];
  for (const mesh of meshes) {
    const bones = array(object(mesh.m_skeleton)?.m_bones);
    if (bones?.length !== 1 || object(bones[0])?.m_boneName !== names[0] || object(bones[0])?.m_parentName !== '')
      return null;
    const inverseBind = array(object(bones[0])?.m_invBindPose);
    if (
      inverseBind?.length !== 12 ||
      !inverseBind.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6)
    )
      return null;
    inverseBinds.push(inverseBind as number[]);
  }
  if (!metadata) return rotationEnvelope(bounds, inverseBinds);
  const { animation, group, sequence } = metadata;
  const key = object(group.m_decodeKey),
    bone = object(array(key?.m_boneArray)?.[0]);
  if (
    !key ||
    array(key.m_boneArray)?.length !== 1 ||
    bone?.m_name !== names[0] ||
    bone.m_parent !== -1 ||
    bone.m_scale !== 1 ||
    !zero(bone.m_pos)
  )
    return null;
  if (
    !one(group.m_localHAnimArray, '') ||
    !empty(group.m_includedGroupArray) ||
    group.m_directHSeqGroup !== '' ||
    !empty(group.m_szScripts) ||
    !empty(key.m_userArray) ||
    !empty(key.m_morphArray) ||
    key.m_nChannelElements !== 3
  )
    return null;
  const channels = array(key.m_dataChannelArray),
    decoders = array(animation.m_decoderArray),
    segments = array(animation.m_segmentArray),
    clips = array(animation.m_animArray);
  if (channels?.length !== 3 || !decoders?.length || segments?.length !== 3 || !clips?.length) return null;
  const channelNames = ['Position', 'Angle', 'Scale'];
  for (let index = 0; index < 3; index++) {
    const channel = object(channels[index]);
    if (
      !channel ||
      channel.m_szChannelClass !== 'BoneChannel' ||
      channel.m_szVariableName !== channelNames[index] ||
      !one(channel.m_szElementNameArray, names[0]) ||
      !one(channel.m_nElementIndexArray, index)
    )
      return null;
    const segment = object(segments[index]),
      hex = object(segment?.m_container)?.binaryHex;
    if (segment?.m_nLocalChannel !== index || typeof hex !== 'string' || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2)
      return null;
    const bytes = Buffer.from(hex, 'hex');
    if (
      bytes.length < 10 ||
      bytes.readInt16LE(4) !== 1 ||
      bytes.readInt16LE(6) !== bytes.length ||
      bytes.readInt16LE(8) !== index
    )
      return null;
    const decoder = object(decoders[bytes.readInt16LE(0)]);
    if (decoder?.m_nVersion !== 0) return null;
    const data = bytes.subarray(10);
    if (index === 0) {
      if (decoder.m_szName === 'CCompressedStaticVector3') {
        if (data.length !== 6 || [0, 2, 4].some((offset) => (data.readUInt16LE(offset) & 0x7fff) !== 0)) return null;
      } else if (decoder.m_szName === 'CCompressedStaticFullVector3') {
        if (data.length !== 12 || [0, 4, 8].some((offset) => data.readFloatLE(offset) !== 0)) return null;
      } else return null;
    } else if (index === 1) {
      // Six-byte packed quaternions decode to rotations; their precise angle is immaterial to a sphere.
      if (
        !['CCompressedStaticQuaternion', 'CCompressedAnimQuaternion'].includes(
          typeof decoder.m_szName === 'string' ? decoder.m_szName : '',
        ) ||
        data.length !== 6
      )
        return null;
    } else if (decoder.m_szName !== 'CCompressedStaticFloat' || data.length !== 4 || data.readFloatLE(0) !== 1)
      return null;
  }
  for (const item of clips) {
    const clip = object(item),
      flags = object(clip?.m_flags),
      data = object(clip?.m_pData),
      blocks = array(data?.m_frameblockArray),
      block = object(blocks?.[0]);
    if (
      !clip ||
      !flags ||
      ['m_bDelta', 'm_bLegacyWorldspace', 'm_bAnimGraphAdditive'].some((key) => flags[key] !== false) ||
      data?.m_nFrames !== 1 ||
      blocks?.length !== 1 ||
      block?.m_nStartFrame !== 0 ||
      block.m_nEndFrame !== 0 ||
      JSON.stringify(block.m_segmentIndexArray) !== '[0,1,2]'
    )
      return null;
    if (
      !empty(clip.m_movementArray) ||
      !empty(clip.m_hierarchyArray) ||
      !empty(clip.m_eventArray) ||
      !zero(clip.m_vecRootMin) ||
      !zero(clip.m_vecRootMax)
    )
      return null;
  }
  if (
    [
      'm_localMultiSeqDescArray',
      'm_localSynthAnimDescArray',
      'm_localCmdSeqDescArray',
      'm_localScaleSetArray',
      'm_localPoseParamArray',
      'm_localIKAutoplayLockArray',
    ].some((key) => !empty(sequence[key]))
  )
    return null;
  const sequences = array(sequence.m_localS1SeqDescArray);
  if (!sequences?.length || sequences.length !== clips.length) return null;
  for (const item of sequences) {
    const seq = object(item),
      flags = object(seq?.m_flags),
      fetch = object(seq?.m_fetch),
      fetchFlags = object(fetch?.m_flags),
      references = array(fetch?.m_localReferenceArray);
    if (
      !seq ||
      !flags ||
      ['m_bLegacyDelta', 'm_bLegacyWorldspace', 'm_bMulti', 'm_bPost'].some((key) => flags[key] !== false) ||
      !empty(seq.m_autoLayerArray) ||
      !empty(seq.m_IKLockArray) ||
      !empty(seq.m_footMotion)
    )
      return null;
    if (
      !fetch ||
      fetchFlags?.m_b0D !== true ||
      fetch.m_bCalculatePoseParameters !== false ||
      references?.length !== 1 ||
      typeof references[0] !== 'number' ||
      !Number.isInteger(references[0]) ||
      references[0] < 0 ||
      references[0] >= clips.length
    )
      return null;
  }
  // Render bounds contain every authored vertex. The root is at the origin and
  // has no translational/scale animation, so its largest corner norm bounds all rotations.
  return rotationEnvelope(bounds, inverseBinds);
}

function rotationEnvelope(bounds: Source2ModelBounds, inverseBinds: number[][]): Source2ModelBounds | null {
  let radius = 0;
  for (const matrix of inverseBinds) {
    for (let corner = 0; corner < 8; corner++) {
      const point = [0, 1, 2].map((axis) => ((corner & (1 << axis)) === 0 ? bounds.min[axis] : bounds.max[axis]));
      radius = Math.max(
        radius,
        Math.hypot(
          ...[0, 1, 2].map(
            (axis) =>
              matrix[axis * 4] * point[0] +
              matrix[axis * 4 + 1] * point[1] +
              matrix[axis * 4 + 2] * point[2] +
              matrix[axis * 4 + 3],
          ),
        ),
      );
    }
  }
  return Number.isFinite(radius) && radius > 0 && radius <= 1e6
    ? { min: [-radius, -radius, -radius], max: [radius, radius, radius] }
    : null;
}

/** Only unskinned, unanimated geometry earns rigid bounds. Entity transforms remain the caller's responsibility. */
export function inspectSource2ModelMetadata(
  model: KeyObject,
  meshes: KeyObject[],
  dataDump: string,
  animations?: AnimationMetadata,
): {
  authoredBounds: Source2ModelBounds | null;
  rigidBounds: Source2ModelBounds | null;
  boundsKind: 'rigid' | 'rotation-envelope' | null;
  resourceHasNoRenderMeshes: boolean;
  blockingReasons: string[];
} {
  const reasons = new Set<string>();
  const skeleton = object(model.m_modelSkeleton);
  if (!skeleton || !array(skeleton.m_boneName)) reasons.add('skeleton-metadata-missing');
  else if ((array(skeleton.m_boneName)?.length ?? 0) > 0) reasons.add('skeletal-model');
  const animationKeys = [
    'm_refAnimGroups',
    'm_refSequenceGroups',
    'm_refAnimIncludeModels',
    'm_animGraph2Refs',
    'm_vecNmSkeletonRefs',
  ];
  if (animationKeys.some((key) => nonempty(model[key])) || /-- Block: (?:ANIM|ASEQ|AGRP)\s/.test(dataDump))
    reasons.add('animation-present');
  if (nonempty(model.m_boneFlexDrivers) || /-- Block: MRPH\s/.test(dataDump)) reasons.add('morph-present');
  if (nonempty(model.m_ExtParts)) reasons.add('external-model-parts');
  if (nonempty(model.m_AnimatedMaterialAttributes)) reasons.add('animated-material');
  const keyValues = object(model.m_modelInfo)?.m_keyValueText;
  if (typeof keyValues === 'string' && /constraint|cloth|jiggle/i.test(keyValues))
    reasons.add('procedural-deformation');
  const bounds: Source2ModelBounds[] = [];
  if (meshes.length === 0) reasons.add('render-mesh-missing');
  for (const mesh of meshes) {
    if (nonempty(mesh.m_bones) || nonempty(object(mesh.m_skeleton)?.m_bones)) reasons.add('skinned-mesh');
    if (nonempty(mesh.m_morphSet) || nonempty(mesh.m_pGroomData) || nonempty(mesh.m_constraints))
      reasons.add('mesh-deformation');
    const deform = object(mesh.m_meshDeformParams);
    if (
      deform?.m_bRecomputeSmoothNormalsAfterAnimation === true ||
      deform?.m_bComputeDynamicMeshTensionAfterAnimation === true
    )
      reasons.add('mesh-deformation');
    const objects = array(mesh.m_sceneObjects);
    if (!objects?.length) {
      reasons.add('mesh-bounds-missing');
      continue;
    }
    for (const item of objects) {
      const scene = object(item),
        min = vector(scene?.m_vMinBounds),
        max = vector(scene?.m_vMaxBounds);
      if (!min || !max || min.some((v, axis) => v > max[axis])) reasons.add('mesh-bounds-invalid');
      else bounds.push({ min, max });
    }
  }
  const authoredBounds: Source2ModelBounds | null =
    bounds.length > 0 && !reasons.has('mesh-bounds-missing') && !reasons.has('mesh-bounds-invalid')
      ? {
          min: [0, 1, 2].map((axis) => Math.min(...bounds.map((b) => b.min[axis]))) as Vector,
          max: [0, 1, 2].map((axis) => Math.max(...bounds.map((b) => b.max[axis]))) as Vector,
        }
      : null;
  const resourceBlocks = Array.from(dataDump.matchAll(/-- Block: ([A-Z0-9]+)\s/g), (match) => match[1]);
  const resourceHasNoRenderMeshes =
    meshes.length === 0 &&
    resourceBlocks.includes('DATA') &&
    resourceBlocks.every((block) => ['DATA', 'CTRL', 'PHYS', 'RERL', 'RED2', 'REDI'].includes(block)) &&
    ['m_refMeshes', 'm_ExtParts', 'm_refAnimGroups', 'm_refSequenceGroups', 'm_refAnimIncludeModels'].every(
      (key) => array(model[key])?.length === 0,
    ) &&
    [...reasons].every((reason) => reason === 'render-mesh-missing');
  if (resourceHasNoRenderMeshes) reasons.delete('render-mesh-missing');
  if (
    authoredBounds &&
    (animations || !reasons.has('animation-present')) &&
    [...reasons].every((reason) => ['skeletal-model', 'animation-present', 'skinned-mesh'].includes(reason))
  ) {
    const envelope = inspectRotationOnlyEnvelope(model, meshes, authoredBounds, animations);
    if (envelope)
      return {
        authoredBounds,
        rigidBounds: envelope,
        boundsKind: 'rotation-envelope',
        resourceHasNoRenderMeshes: false,
        blockingReasons: [],
      };
  }
  return {
    authoredBounds,
    rigidBounds: reasons.size === 0 ? authoredBounds : null,
    boundsKind: reasons.size === 0 && authoredBounds ? 'rigid' : null,
    resourceHasNoRenderMeshes,
    blockingReasons: [...reasons],
  };
}

type ReadyModel = Extract<Source2ModelResourceResult, { status: 'ready' }>;

export function inspectSource2StaticHullBounds(physics: KeyObject): Source2ModelBounds | null {
  const empty = (value: KeyValue | undefined) => Array.isArray(value) && value.length === 0;
  if (
    ['m_bindPose', 'm_boneNames', 'm_bonesHash', 'm_boneParents', 'm_constraints2', 'm_joints', 'm_shapeMarkups'].some(
      (key) => !empty(physics[key]),
    ) ||
    physics.m_pFeModel !== null ||
    physics.m_bCompoundsPacked !== false
  )
    return null;
  const parts = array(physics.m_parts),
    bounds: Source2ModelBounds[] = [];
  if (!parts?.length || parts.length > 4096) return null;
  for (const item of parts) {
    const shape = object(object(item)?.m_rnShape),
      hulls = array(shape?.m_hulls);
    if (
      !shape ||
      !hulls?.length ||
      hulls.length > 4096 ||
      ['m_spheres', 'm_capsules', 'm_meshes', 'm_compounds'].some((key) => !empty(shape[key]))
    )
      return null;
    for (const item of hulls) {
      if (bounds.length >= 4096) return null;
      const authored = object(object(item)?.m_Hull),
        bound = object(authored?.m_Bounds);
      const min = vector(bound?.m_vMinBounds),
        max = vector(bound?.m_vMaxBounds);
      if (!min || !max || min.some((v, axis) => v > max[axis])) return null;
      bounds.push({ min, max });
    }
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...bounds.map((bound) => bound.min[axis]))) as Vector,
    max: [0, 1, 2].map((axis) => Math.max(...bounds.map((bound) => bound.max[axis]))) as Vector,
  };
}
type ModelCache = {
  version: number;
  sourceRevision: string;
  dependencies: Source2ResourceEntry[];
  result: ReadyModel;
  digest: string;
};
const CACHE_VERSION = 4;
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function validBounds(value: unknown): value is Source2ModelBounds {
  if (value === null || typeof value !== 'object') return false;
  const bounds = value as Source2ModelBounds;
  const min = vector(bounds.min),
    max = vector(bounds.max);
  return !!min && !!max && min.every((value, axis) => value <= max[axis]);
}
function validCachedModel(
  cache: ModelCache,
  entry: Source2ResourceEntry,
  modelId: string,
  sourceRevision: string,
  entries: Source2ResourceEntry[],
): boolean {
  if (
    cache.version !== CACHE_VERSION ||
    cache.sourceRevision !== sourceRevision ||
    !Array.isArray(cache.dependencies) ||
    cache.dependencies.length < 1 ||
    cache.dependencies.length > 64
  )
    return false;
  const { digest: storedDigest, ...payload } = cache;
  if (storedDigest !== digest(payload) || JSON.stringify(cache.dependencies[0]) !== JSON.stringify(entry)) return false;
  if (
    !cache.dependencies.every(
      (dep) =>
        entries.filter((item) => item.path === dep.path).length === 1 &&
        entries.some(
          (item) =>
            item.path === dep.path &&
            item.vpkPath === dep.vpkPath &&
            item.crc32 === dep.crc32 &&
            item.size === dep.size,
        ),
    )
  )
    return false;
  const value = cache.result;
  if (
    !value ||
    value.status !== 'ready' ||
    value.modelId !== modelId ||
    value.resourcePath !== entry.path.slice(0, -2) ||
    !/^[a-f0-9]{64}$/.test(value.metadataFingerprint) ||
    !Number.isSafeInteger(value.meshCount) ||
    value.meshCount < 0 ||
    typeof value.resourceHasNoRenderMeshes !== 'boolean' ||
    !Array.isArray(value.blockingReasons) ||
    value.blockingReasons.some((reason) => typeof reason !== 'string')
  )
    return false;
  if (value.authoredBounds !== null && !validBounds(value.authoredBounds)) return false;
  if (value.physicsBounds !== undefined && value.physicsBounds !== null && !validBounds(value.physicsBounds))
    return false;
  if (
    value.resourceHasNoRenderMeshes &&
    (value.meshCount !== 0 ||
      value.rigidBounds !== null ||
      value.authoredBounds !== null ||
      value.blockingReasons.length !== 0)
  )
    return false;
  if (
    value.rigidBounds !== null &&
    (!validBounds(value.rigidBounds) ||
      !value.authoredBounds ||
      value.blockingReasons.length > 0 ||
      !['rigid', 'rotation-envelope'].includes(value.boundsKind ?? ''))
  )
    return false;
  return value.rigidBounds !== null || value.boundsKind === null;
}

export function createSource2ModelResourceResolver(
  options: ToolOptions & { vpkPaths: string[]; cacheDirectory?: string; sourceRevision?: string },
) {
  let inventoryPromise: Promise<Source2ResourceEntry[]> | undefined;
  let modelsById: Map<string, Source2ResourceEntry[]> | undefined;
  const pending = new Map<string, Promise<Source2ModelResourceResult>>();
  const inventory = () =>
    (inventoryPromise ??= Promise.all(
      options.vpkPaths.map((vpkPath) => readSource2PackageIndex({ ...options, vpkPath })),
    ).then((all) => {
      const seen = new Set<string>();
      return all.flat().filter((entry) => {
        const key = `${entry.path}:${entry.crc32}:${entry.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }));
  const locate = (entries: Source2ResourceEntry[], resourcePath: string) => {
    const hits = entries.filter((entry) => entry.path === resourcePath);
    return hits.length === 1 ? hits[0] : null;
  };
  const resolve = async (modelId: string, includePhysicsBounds: boolean): Promise<Source2ModelResourceResult> => {
    try {
      options.signal?.throwIfAborted();
      if (!/^\d{1,20}$/.test(modelId) || BigInt(modelId) > 0xffffffffffffffffn) throw new Error('invalid-model-id');
      const entries = await inventory();
      if (!modelsById) {
        modelsById = new Map();
        for (const item of entries.filter((entry) => entry.path.endsWith('.vmdl_c'))) {
          const id = computeSource2ResourceId(item.path.slice(0, -2));
          const hits = modelsById.get(id) ?? [];
          hits.push(item);
          modelsById.set(id, hits);
        }
      }
      const hits = modelsById.get(modelId) ?? [];
      if (hits.length !== 1)
        return {
          status: 'unavailable',
          modelId,
          reason: hits.length ? 'ambiguous-model-resource' : 'model-resource-missing',
        };
      const entry = hits[0];
      const sourceRevision = options.sourceRevision ?? '';
      const cachePath = options.cacheDirectory
        ? path.join(
            options.cacheDirectory,
            `${digest([CACHE_VERSION, sourceRevision, options.vpkPaths, modelId, ...(includePhysicsBounds ? ['physics'] : [])])}.json`,
          )
        : null;
      if (cachePath) {
        try {
          const stat = await fs.stat(cachePath);
          if (stat.size <= 256_000) {
            const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as ModelCache;
            if (validCachedModel(cache, entry, modelId, sourceRevision, entries)) {
              options.signal?.throwIfAborted();
              return cache.result;
            }
          }
        } catch {
          /* Cache corruption or changed assets cause a bounded metadata rebuild. */
        }
      }
      const dataDump = await readSource2ResourceBlock({ ...options, entry, block: 'DATA' });
      const models = parseSource2ResourceDumpBlocks(dataDump, 'DATA');
      if (models.length !== 1 || models[0].m_name !== entry.path.slice(0, -2))
        throw new Error('model-metadata-mismatch');
      const model = models[0],
        meshes: KeyObject[] = [],
        fingerprints = [dataDump],
        dependencies = [entry];
      const embeddedCount = [...dataDump.matchAll(/-- Block: MDAT\s/g)].length;
      if (embeddedCount > 0) {
        const dump = await readSource2ResourceBlock({ ...options, entry, block: 'MDAT' });
        const embedded = parseSource2ResourceDumpBlocks(dump, 'MDAT');
        if (embedded.length !== embeddedCount) throw new Error('embedded-mesh-metadata-incomplete');
        meshes.push(...embedded);
        fingerprints.push(dump);
      }
      const references = array(model.m_refMeshes);
      if (!references) throw new Error('mesh-references-missing');
      for (const name of references.filter((ref) => ref !== '')) {
        if (typeof name !== 'string' || !validResourcePath(name) || !name.endsWith('.vmesh'))
          throw new Error('invalid-mesh-reference');
        const meshEntry = locate(entries, `${name}_c`);
        if (!meshEntry) throw new Error('external-mesh-missing-or-ambiguous');
        dependencies.push(meshEntry);
        const dump = await readSource2ResourceBlock({ ...options, entry: meshEntry, block: 'DATA' });
        const blocks = parseSource2ResourceDumpBlocks(dump, 'DATA');
        if (blocks.length !== 1) throw new Error('external-mesh-metadata-incomplete');
        meshes.push(blocks[0]);
        fingerprints.push(dump);
      }
      let animations: AnimationMetadata | undefined;
      if (
        array(object(model.m_modelSkeleton)?.m_boneName)?.length === 1 &&
        ['ANIM', 'AGRP', 'ASEQ'].every((block) => dataDump.includes(`-- Block: ${block} `))
      ) {
        const values: KeyObject[] = [];
        for (const block of ['ANIM', 'AGRP', 'ASEQ'] as const) {
          const dump = await readSource2ResourceBlock({ ...options, entry, block });
          const decoded = parseSource2ResourceDumpBlocks(dump, block);
          if (decoded.length !== 1) throw new Error('animation-metadata-incomplete');
          fingerprints.push(dump);
          values.push(decoded[0]);
        }
        animations = { animation: values[0], group: values[1], sequence: values[2] };
      }
      const inspected = inspectSource2ModelMetadata(model, meshes, dataDump, animations);
      let physicsBounds: Source2ModelBounds | null = null;
      if (includePhysicsBounds && inspected.resourceHasNoRenderMeshes && /-- Block: PHYS\s/.test(dataDump)) {
        const dump = await readSource2ResourceBlock({ ...options, entry, block: 'PHYS' });
        const blocks = parseSource2ResourceDumpBlocks(dump, 'PHYS');
        if (blocks.length === 1) physicsBounds = inspectSource2StaticHullBounds(blocks[0]);
        fingerprints.push(dump);
      }
      const result: Source2ModelResourceResult = {
        status: 'ready',
        modelId,
        resourcePath: entry.path.slice(0, -2),
        metadataFingerprint: createHash('sha256').update(fingerprints.join('\n')).digest('hex'),
        meshCount: meshes.length,
        ...inspected,
        ...(includePhysicsBounds ? { physicsBounds } : {}),
      };
      options.signal?.throwIfAborted();
      if (cachePath && options.cacheDirectory) {
        await fs.mkdir(options.cacheDirectory, { recursive: true });
        const payload = { version: CACHE_VERSION, sourceRevision, dependencies, result };
        const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporaryPath, JSON.stringify({ ...payload, digest: digest(payload) }));
          await fs.rename(temporaryPath, cachePath);
        } finally {
          await fs.rm(temporaryPath, { force: true });
        }
      }
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return {
        status: 'unavailable',
        modelId,
        reason: error instanceof Error ? error.message : 'model-resource-error',
      };
    }
  };
  return {
    resolveModel(modelId: string, request: { includePhysicsBounds?: boolean } = {}) {
      const includePhysicsBounds = request.includePhysicsBounds === true;
      const key = `${modelId}:${includePhysicsBounds}`;
      let result = pending.get(key);
      if (!result) {
        result = resolve(modelId, includePhysicsBounds);
        pending.set(key, result);
        result.catch(() => pending.delete(key));
      }
      return result;
    },
  };
}
