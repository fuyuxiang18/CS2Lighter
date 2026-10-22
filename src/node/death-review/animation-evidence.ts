import type { DeathAnimationEvidence } from 'csdm/common/types/death-animation';
import type { EvidenceFrame } from './evidence-protocol';

export type EvidenceAnimationContext = {
  type: 'animation-context';
  frame: number;
  tick: number;
  contextId: number;
  taskTypes: { index: number; name: string }[];
  assets: { index: number; path: string; dataBase64: string }[];
  errors: string[];
};

/**
 * Decodes the animation context actually carried by a demo. These are animation
 * instructions, not final bone transforms or a certified shot-time hitbox pose.
 * Format/probe provenance is recorded in docs/research/aim-data.md.
 */
type AnimationAssetData =
  | { kind: 'graph'; version: 1; resources: string[] }
  | { kind: 'skeleton'; version: 1; bones: string[]; masks: string[] };

type AnimationTopology = {
  recipeVersion: 3;
  tasks: { type: string; dependencies: number[] }[];
  consumedBits: number;
};

const maximumPayloadBytes = 1_048_576;
const maximumNames = 16_384;
const maximumNameBytes = 2_048;

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length > Math.ceil(maximumPayloadBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error('Invalid animation payload encoding');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximumPayloadBytes || bytes.toString('base64') !== value) {
    throw new Error('Invalid animation payload encoding');
  }
  return bytes;
}

/** The demo's ordered lists must be used; sorting them changes every recipe index. */
export function decodeAnimationAssetData(resourcePath: string, dataBase64: string): AnimationAssetData {
  const bytes = decodeBase64(dataBase64);
  let offset = 0;
  function readUint32(): number {
    if (offset + 4 > bytes.length) throw new Error('Truncated animation asset data');
    const value = bytes.readUInt32LE(offset);
    offset += 4;
    return value;
  }
  function readNames(): string[] {
    const count = readUint32();
    if (count > maximumNames) throw new Error('Animation asset name limit exceeded');
    const names: string[] = [];
    for (let index = 0; index < count; index++) {
      const end = bytes.indexOf(0, offset);
      if (end === -1 || end === offset || end - offset > maximumNameBytes) {
        throw new Error('Invalid animation asset name');
      }
      const nameBytes = bytes.subarray(offset, end);
      const name = nameBytes.toString('utf8');
      if (!Buffer.from(name, 'utf8').equals(nameBytes)) throw new Error('Invalid animation asset UTF-8');
      names.push(name);
      offset = end + 1;
    }
    return names;
  }
  if (readUint32() !== 1) throw new Error('Unsupported animation asset version');
  let result: AnimationAssetData;
  if (resourcePath.endsWith('.vnmgraph')) {
    result = { kind: 'graph', version: 1, resources: readNames() };
  } else if (resourcePath.endsWith('.vnmskel')) {
    result = { kind: 'skeleton', version: 1, bones: readNames(), masks: readNames() };
  } else {
    throw new Error('Unsupported animation asset type');
  }
  if (offset !== bytes.length) throw new Error('Unexpected trailing animation asset data');
  return result;
}

// These task arities were checked against captured topology slots and windows.
// The last two are CS-specific: recognizing their dependencies does NOT decode
// their dynamic parameters or execute the corresponding pose modification.
const dependencyCounts: Record<string, number> = {
  CNmCachedPoseWriteTask: 1,
  CNmSampleTask: 0,
  CNmSnapWeaponTask: 1,
  CNmBlendTask: 2,
  CNmAdditiveBlendTask: 2,
  CNmModelSpaceBlendTask: 2,
  CNmAimCSTask: 1,
};

/** Decode only the topology, with the originating patch's network task ordering. */
export function decodeAnimationRecipeTopology(input: {
  patch: number | null;
  recipeVersion: number;
  taskTypes: string[];
  topologyBase64: string;
}): AnimationTopology {
  if (input.patch !== 14190 || input.recipeVersion !== 3) {
    throw new Error('Unsupported animation recipe version');
  }
  if (
    input.taskTypes.length === 0 ||
    input.taskTypes.length > 255 ||
    new Set(input.taskTypes).size !== input.taskTypes.length
  ) {
    throw new Error('Invalid animation task table');
  }
  const bytes = decodeBase64(input.topologyBase64);
  if (bytes.length > 4_096) throw new Error('Animation topology limit exceeded');
  let bitOffset = 0;
  function readBits(count: number): number {
    if (bitOffset + count > bytes.length * 8) throw new Error('Truncated animation topology');
    let value = 0;
    for (let bit = 0; bit < count; bit++) {
      value |= ((bytes[Math.floor(bitOffset / 8)] >>> (bitOffset % 8)) & 1) << bit;
      bitOffset++;
    }
    return value;
  }
  const dependencyBits = readBits(4);
  if (dependencyBits === 0 || dependencyBits > 8) throw new Error('Invalid animation dependency bit width');
  const taskCount = readBits(dependencyBits);
  if (taskCount === 0 || taskCount > 255 || Math.floor(Math.log2(taskCount)) + 1 !== dependencyBits) {
    throw new Error('Invalid animation task count');
  }
  // This format encodes the bit width of the count, including powers of two.
  // Sixteen task types therefore use five bits, not four.
  const typeBits = Math.floor(Math.log2(input.taskTypes.length)) + 1;
  const tasks: AnimationTopology['tasks'] = [];
  for (let index = 0; index < taskCount; index++) {
    const type = input.taskTypes[readBits(typeBits)];
    if (type === undefined || !Object.hasOwn(dependencyCounts, type)) {
      throw new Error('Unsupported animation topology task');
    }
    const dependencies: number[] = [];
    for (let dependency = 0; dependency < dependencyCounts[type]; dependency++) {
      const target = readBits(dependencyBits);
      if (target >= index) throw new Error('Invalid animation topology dependency');
      dependencies.push(target);
    }
    tasks.push({ type, dependencies });
  }
  const consumedBits = bitOffset;
  const paddingBits = bytes.length * 8 - consumedBits;
  if (paddingBits > 7 || readBits(paddingBits) !== 0) throw new Error('Unexpected trailing animation topology');
  return { recipeVersion: 3, tasks, consumedBits };
}

/** Summarizes decoded instructions without manufacturing an aim proof. */
export function buildAnimationEvidence(input: {
  patch: number | null;
  contexts: EvidenceAnimationContext[];
  frames: EvidenceFrame[];
  subjectId: string;
}): DeathAnimationEvidence {
  const result: DeathAnimationEvidence = {
    framesWithRecipe: 0,
    decodedTopologyFrames: 0,
    taskTypes: [],
    graphResourceCount: 0,
    boneCount: 0,
    maskCount: 0,
    blockingTasks: [],
    reasons: [],
  };
  const reasons = new Set<string>();
  const types = new Set<string>();
  const blockingTasks = new Set<string>();
  const contexts = new Map<number, EvidenceAnimationContext>();
  const invalidContexts = new Set<number>();
  for (const context of input.contexts) {
    if (contexts.has(context.contextId)) invalidContexts.add(context.contextId);
    contexts.set(context.contextId, context);
  }
  const decodedContexts = new Map<number, string[] | null>();
  const decodedTopologies = new Map<string, AnimationTopology | null>();
  for (const frame of input.frames) {
    const actors = frame.players.filter((player) => player.steamId === input.subjectId);
    if (actors.length > 1) {
      reasons.add('animation-actor-ambiguous');
      continue;
    }
    const actor = actors[0];
    const recipe = actor?.animation;
    if (!recipe) continue;
    result.framesWithRecipe++;
    const context = contexts.get(recipe.contextId);
    if (!context || invalidContexts.has(recipe.contextId) || context.tick > frame.tick || context.frame > frame.frame) {
      reasons.add('animation-context-missing');
      continue;
    }
    if (!decodedContexts.has(context.contextId)) {
      let valid =
        context.errors.length === 0 &&
        context.taskTypes.length > 0 &&
        context.taskTypes.length <= 255 &&
        context.assets.length > 0;
      const taskNames = context.taskTypes.toSorted((left, right) => left.index - right.index);
      valid &&= taskNames.every((entry, index) => entry.index === index);
      let graphResourceCount = 0;
      let boneCount = 0;
      let maskCount = 0;
      if (valid) {
        const assetPaths = new Set<string>();
        for (const entry of context.assets) {
          if (assetPaths.has(entry.path)) {
            valid = false;
            break;
          }
          assetPaths.add(entry.path);
          try {
            const asset = decodeAnimationAssetData(entry.path, entry.dataBase64);
            if (asset.kind === 'graph') graphResourceCount = Math.max(graphResourceCount, asset.resources.length);
            else {
              boneCount = Math.max(boneCount, asset.bones.length);
              maskCount = Math.max(maskCount, asset.masks.length);
            }
          } catch {
            valid = false;
            break;
          }
        }
      }
      if (valid) {
        result.graphResourceCount = Math.max(result.graphResourceCount, graphResourceCount);
        result.boneCount = Math.max(result.boneCount, boneCount);
        result.maskCount = Math.max(result.maskCount, maskCount);
      }
      decodedContexts.set(context.contextId, valid ? taskNames.map((entry) => entry.name) : null);
    }
    const taskNames = decodedContexts.get(context.contextId);
    if (!taskNames) {
      reasons.add('animation-context-invalid');
      continue;
    }
    if (
      !recipe.topologyBase64 ||
      !recipe.dynamicBase64 ||
      recipe.recipeVersion === null ||
      recipe.activeSlot === null ||
      !Number.isInteger(recipe.activeSlot) ||
      recipe.activeSlot < 0 ||
      recipe.activeSlot > 31
    ) {
      reasons.add('animation-recipe-incomplete');
      continue;
    }
    try {
      if (decodeBase64(recipe.dynamicBase64).length > 4_096) throw new Error('Animation dynamic limit exceeded');
    } catch {
      reasons.add('animation-recipe-incomplete');
      continue;
    }
    const key = `${context.contextId}/${recipe.recipeVersion}/${recipe.topologyBase64}`;
    if (!decodedTopologies.has(key)) {
      try {
        decodedTopologies.set(
          key,
          decodeAnimationRecipeTopology({
            patch: input.patch,
            recipeVersion: recipe.recipeVersion,
            taskTypes: taskNames,
            topologyBase64: recipe.topologyBase64,
          }),
        );
      } catch {
        decodedTopologies.set(key, null);
      }
    }
    const topology = decodedTopologies.get(key);
    if (!topology) {
      reasons.add('animation-topology-unsupported');
      continue;
    }
    result.decodedTopologyFrames++;
    for (const task of topology.tasks) {
      types.add(task.type);
      if (task.type === 'CNmAimCSTask' || task.type === 'CNmSnapWeaponTask') blockingTasks.add(task.type);
    }
    reasons.add('animation-pose-execution-unverified');
    reasons.add('animation-shot-clock-unverified');
  }
  if (result.framesWithRecipe === 0) reasons.add('animation-recipe-missing');
  result.taskTypes = [...types].sort();
  result.blockingTasks = [...blockingTasks].sort();
  result.reasons = [...reasons].sort();
  return result;
}
