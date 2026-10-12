import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeVisibilityMeshCache, type VisibilityMesh } from 'csdm/node/death-review/visibility-mesh';
import { auditVisibilityResources } from 'csdm/node/death-review/visibility-resource-audit';

const MAX_MESH_BYTES = 256 * 1024 * 1024;
const MAX_GLB_BYTES = 512 * 1024 * 1024;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
type BuildMatch = { demoPatch: number; installedPatch: number; clientVersion: number; buildId: number };
type FileStamp = { name: string; size: number; modified: number };
type SourceInventory = {
  vpkSha256: string;
  packageIndexSha256: string;
  files: FileStamp[];
};
type VisibilityMapManifest = {
  version: 1;
  mapName: string;
  matchType: 'installed-build-matched';
  buildMatch: BuildMatch;
  sourceFingerprint: string;
  inventory: SourceInventory;
  exporter: 'Source 2 Viewer 20';
  sourceAssetHash: string;
  meshBytes: number;
  triangleCount: number;
  createdAt: string;
  resourceAudit: { complete: true; checked: number };
};
type Request = {
  csgoDirectory: string;
  mapName: string;
  demoPatch: number;
  cacheDirectory: string;
  vrfExecutable: string;
  worker: { executable: string; args: string[]; runAsNode?: boolean };
  signal: AbortSignal;
  onProgress?: (stage: 'inventory' | 'export' | 'bake' | 'cache') => void;
};
type Result =
  | {
      status: 'ready';
      mesh: VisibilityMesh;
      manifest: VisibilityMapManifest;
      provenance: {
        mapName: string;
        sourceFingerprint: string;
        demoFingerprint: null;
        matchType: 'installed-build-matched';
        buildMatch: BuildMatch;
        coordinates: 'source';
        opaqueCoverageComplete: boolean;
      };
    }
  | { status: 'unavailable'; reason: string };

const memory = new Map<string, { stamp: string; bytes: number; mesh: VisibilityMesh }>();

async function readSmall(file: string, maxBytes = 64 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('Visibility metadata exceeds its size limit');
  return fs.readFile(file, 'utf8');
}

/** Cheap context revision; also stable when a map or CS2 installation is missing. */
export async function readVisibilityMapRevision(csgoDirectory: string, mapName: string): Promise<string> {
  const parts: unknown[] = [path.resolve(csgoDirectory), mapName];
  if (!path.isAbsolute(csgoDirectory) || !/^[a-z0-9_]{1,64}$/.test(mapName)) parts.push('invalid-location');
  else {
    const names = await fs.readdir(csgoDirectory).catch(() => [] as string[]);
    const sources = names.filter((name) => /^pak01_(?:dir|\d+)\.vpk$/i.test(name));
    sources.push(`maps/${mapName}.vpk`, 'steam.inf', '../../../../appmanifest_730.acf');
    for (const name of sources.sort()) {
      try {
        const file = path.join(csgoDirectory, name),
          stat = await fs.stat(file);
        parts.push([name, stat.size, stat.mtimeMs]);
        if (name.endsWith('.inf') || name.endsWith('.acf')) parts.push(await readSmall(file));
      } catch {
        parts.push([name, 'missing']);
      }
    }
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Exact version mapping checked against Valve's public steam.inf history. */
export function matchVisibilityBuild(demoPatch: number, steamInf: string, appManifest: string): BuildMatch | null {
  const clientVersion = Number(/^ClientVersion=(\d+)\s*$/m.exec(steamInf)?.[1]);
  const patch = /^PatchVersion=(\d+)\.(\d+)\.(\d+)\.(\d+)\s*$/m.exec(steamInf);
  const installedPatch = patch ? Number(patch.slice(1).join('')) : NaN;
  const buildId = Number(/"buildid"\s+"(\d+)"/.exec(appManifest)?.[1]);
  if (demoPatch !== 14190 || installedPatch !== 14190 || clientVersion !== 2000930 || buildId !== 25815307) return null;
  return { demoPatch, installedPatch, clientVersion, buildId };
}

async function hashFile(file: string, signal: AbortSignal) {
  const hash = createHash('sha256');
  const stream = createReadStream(file, { signal });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(csgoDirectory: string, mapName: string, signal: AbortSignal): Promise<SourceInventory> {
  const names = (await fs.readdir(csgoDirectory)).filter((name) => /^pak01_(?:dir|\d+)\.vpk$/i.test(name));
  if (!names.includes('pak01_dir.vpk')) throw new Error('CS2 package index is missing');
  names.push(`maps/${mapName}.vpk`);
  names.sort();
  const files: FileStamp[] = [];
  for (const name of names) {
    signal.throwIfAborted();
    const stat = await fs.stat(path.join(csgoDirectory, name));
    if (!stat.isFile() || stat.size <= 0) throw new Error('CS2 source asset is missing');
    files.push({ name, size: stat.size, modified: stat.mtimeMs });
  }
  return {
    vpkSha256: await hashFile(path.join(csgoDirectory, 'maps', `${mapName}.vpk`), signal),
    packageIndexSha256: await hashFile(path.join(csgoDirectory, 'pak01_dir.vpk'), signal),
    files,
  };
}

async function unchanged(csgoDirectory: string, source: SourceInventory) {
  for (const stamp of source.files) {
    const stat = await fs.stat(path.join(csgoDirectory, stamp.name));
    if (stat.size !== stamp.size || stat.mtimeMs !== stamp.modified) return false;
  }
  return true;
}

async function runTool(
  executable: string,
  args: string[],
  signal: AbortSignal,
  options: { input?: string; outputPath?: string; maxBytes?: number; runAsNode?: boolean } = {},
) {
  signal.throwIfAborted();
  const child = spawn(executable, args, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.runAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  });
  let failure: Error | undefined;
  let output = '';
  const stop = (error: Error) => {
    failure ??= error;
    child.kill();
  };
  const abort = () => stop(new Error('Visibility map preparation canceled'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => stop(new Error('Visibility map preparation timed out')), 180_000);
  const monitor = setInterval(() => {
    if (!options.outputPath) return;
    void fs.stat(options.outputPath).then(
      (stat) => {
        if (stat.size > (options.maxBytes ?? MAX_GLB_BYTES)) stop(new Error('Visibility map exceeds its size limit'));
      },
      () => {},
    );
  }, 250);
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', (error) => stop(error));
    child.once('close', (code) => resolve(code));
  });
  const collect = (data: Buffer) => {
    output = (output + data.toString('utf8')).slice(-16_384);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.stdin.on('error', (error) => stop(error));
  child.stdin.end(options.input);
  try {
    const code = await closed;
    signal.throwIfAborted();
    if (failure) throw failure;
    if (code !== 0) throw new Error(output.trim().slice(-2048) || 'Visibility map helper failed');
    return output;
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
    signal.removeEventListener('abort', abort);
  }
}

async function readMesh(file: string, sourceAssetHash: string) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_MESH_BYTES) throw new Error('Visibility cache exceeds its size limit');
  const key = `${file}:${sourceAssetHash}`;
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const previous = memory.get(key);
  if (previous?.stamp === stamp) {
    memory.delete(key);
    memory.set(key, previous);
    return previous.mesh;
  }
  const mesh = decodeVisibilityMeshCache(await fs.readFile(file), sourceAssetHash);
  if (stat.size <= MAX_MEMORY_BYTES) {
    memory.delete(key);
    memory.set(key, { stamp, bytes: stat.size, mesh });
    let total = [...memory.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [oldKey, entry] of memory) {
      if (total <= MAX_MEMORY_BYTES) break;
      memory.delete(oldKey);
      total -= entry.bytes;
    }
  }
  return mesh;
}

export async function resolveVisibilityMap(request: Request): Promise<Result> {
  request.signal.throwIfAborted();
  if (!/^[a-z0-9_]{1,64}$/.test(request.mapName)) return { status: 'unavailable', reason: 'unsupported-map-name' };
  if (![request.csgoDirectory, request.cacheDirectory].every(path.isAbsolute))
    return { status: 'unavailable', reason: 'invalid-directory' };
  let scratch: string | undefined;
  try {
    request.onProgress?.('inventory');
    const steamInf = await readSmall(path.join(request.csgoDirectory, 'steam.inf'));
    const appManifestPath = path.resolve(request.csgoDirectory, '..', '..', '..', '..', 'appmanifest_730.acf');
    const buildMatch = matchVisibilityBuild(request.demoPatch, steamInf, await readSmall(appManifestPath));
    if (!buildMatch) return { status: 'unavailable', reason: 'installed-build-mismatch' };
    const initialRevision = await readVisibilityMapRevision(request.csgoDirectory, request.mapName);
    const source = await inventory(request.csgoDirectory, request.mapName, request.signal);
    const resourceAudit = await auditVisibilityResources(request);
    if (!resourceAudit.complete)
      return { status: 'unavailable', reason: `map-render-dependencies-missing:${resourceAudit.missing.join(',')}` };
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ buildMatch, source })).digest('hex');
    const stem = `${request.mapName}-${sourceFingerprint}`;
    const manifestPath = path.join(request.cacheDirectory, `${stem}.json`);
    const meshPath = path.join(request.cacheDirectory, `${stem}.mesh`);
    let manifest: VisibilityMapManifest | undefined;
    let mesh: VisibilityMesh | undefined;
    try {
      const candidate = JSON.parse(await readSmall(manifestPath, 1024 * 1024)) as VisibilityMapManifest;
      if (
        candidate.version === 1 &&
        candidate.mapName === request.mapName &&
        candidate.matchType === 'installed-build-matched' &&
        candidate.sourceFingerprint === sourceFingerprint &&
        JSON.stringify(candidate.buildMatch) === JSON.stringify(buildMatch) &&
        JSON.stringify(candidate.inventory) === JSON.stringify(source) &&
        candidate.exporter === 'Source 2 Viewer 20'
      ) {
        mesh = await readMesh(meshPath, candidate.sourceAssetHash);
        if (mesh.triangleCount === candidate.triangleCount && (await fs.stat(meshPath)).size === candidate.meshBytes)
          manifest = { ...candidate, resourceAudit: { complete: true, checked: resourceAudit.checked } };
      }
    } catch {
      // Incomplete or damaged derived files are rebuilt, never interpreted as an empty map.
    }
    if (!manifest || !mesh) {
      const version = await runTool(request.vrfExecutable, ['--version'], request.signal);
      if (!/\b20\.0\./.test(version)) return { status: 'unavailable', reason: 'unsupported-map-exporter' };
      await fs.mkdir(request.cacheDirectory, { recursive: true });
      scratch = path.join(request.cacheDirectory, `.bake-${randomUUID()}`);
      await fs.mkdir(scratch);
      const glbPath = path.join(scratch, 'world.glb');
      const bakedPath = path.join(scratch, 'world.mesh');
      request.onProgress?.('export');
      await runTool(
        request.vrfExecutable,
        [
          '-i',
          path.join(request.csgoDirectory, 'maps', `${request.mapName}.vpk`),
          '-f',
          `maps/${request.mapName}/world.vwrld_c`,
          '-o',
          glbPath,
          '-d',
          '--gltf_export_format',
          'glb',
        ],
        request.signal,
        { outputPath: glbPath },
      );
      const glbStat = await fs.stat(glbPath);
      if (glbStat.size <= 0 || glbStat.size > MAX_GLB_BYTES) throw new Error('Visibility map exceeds its size limit');
      request.onProgress?.('bake');
      const result = await runTool(request.worker.executable, request.worker.args, request.signal, {
        input: JSON.stringify({ inputGlb: glbPath, outputCache: bakedPath }),
        outputPath: bakedPath,
        maxBytes: MAX_MESH_BYTES,
        runAsNode: request.worker.runAsNode,
      });
      const baked = JSON.parse(result.trim()) as { sourceAssetHash: string; triangleCount: number };
      mesh = await readMesh(bakedPath, baked.sourceAssetHash);
      if (mesh.triangleCount !== baked.triangleCount || mesh.hasAnimatedNodes)
        throw new Error('Visibility map contains unsupported animation or inconsistent geometry');
      if (!(await unchanged(request.csgoDirectory, source)))
        throw new Error('CS2 assets changed during map preparation');
      const meshBytes = (await fs.stat(bakedPath)).size;
      manifest = {
        version: 1,
        mapName: request.mapName,
        matchType: 'installed-build-matched',
        buildMatch,
        sourceFingerprint,
        inventory: source,
        exporter: 'Source 2 Viewer 20',
        sourceAssetHash: mesh.sourceAssetHash,
        triangleCount: mesh.triangleCount,
        meshBytes,
        createdAt: new Date().toISOString(),
        resourceAudit: { complete: true, checked: resourceAudit.checked },
      };
      request.signal.throwIfAborted();
      await fs.rename(bakedPath, meshPath);
      const pendingManifest = path.join(scratch, 'manifest.json');
      await fs.writeFile(pendingManifest, JSON.stringify(manifest), 'utf8');
      await fs.rename(pendingManifest, manifestPath);
    }
    request.signal.throwIfAborted();
    if (!(await unchanged(request.csgoDirectory, source)))
      throw new Error('CS2 assets changed while reading map cache');
    if ((await readVisibilityMapRevision(request.csgoDirectory, request.mapName)) !== initialRevision)
      throw new Error('CS2 build changed while preparing map cache');
    request.onProgress?.('cache');
    return {
      status: 'ready',
      mesh,
      manifest,
      provenance: {
        mapName: request.mapName,
        sourceFingerprint,
        demoFingerprint: null,
        matchType: 'installed-build-matched',
        buildMatch,
        coordinates: 'source',
        opaqueCoverageComplete: resourceAudit.complete && !mesh.hasAnimatedNodes,
      },
    };
  } catch (error) {
    request.signal.throwIfAborted();
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'map-preparation-failed' };
  } finally {
    if (scratch) {
      const resolved = path.resolve(scratch);
      const parent = path.resolve(request.cacheDirectory);
      if (path.dirname(resolved) === parent && /^\.bake-[a-f0-9-]+$/.test(path.basename(resolved)))
        await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}
