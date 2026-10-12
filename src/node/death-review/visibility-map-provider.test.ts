import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { encodeVisibilityMeshCache } from 'csdm/node/death-review/visibility-mesh';
import {
  matchVisibilityBuild,
  readVisibilityMapRevision,
  resolveVisibilityMap,
} from 'csdm/node/death-review/visibility-map-provider';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('csdm/node/death-review/visibility-resource-audit', () => ({
  auditVisibilityResources: () => Promise.resolve({ complete: true, checked: 1, missing: [] }),
}));
const steamInf = 'ClientVersion=2000930\nPatchVersion=1.41.9.0\n';
const appManifest = '"AppState" { "buildid" "25815307" }';
let temporary: string;
let csgoDirectory: string;
let cacheDirectory: string;
let failure: 'export' | 'worker' | undefined;
const packed = Buffer.alloc(36);
[0, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, index) => packed.writeFloatLE(value, index * 4));
const mesh = {
  sourceAssetHash: 'a'.repeat(64),
  triangleCount: 1,
  maximumRoundingError: 0,
  hasAnimatedNodes: false,
  chunks: [
    {
      min: [0, 0, 0] as const,
      max: [0, 1, 1] as const,
      label: 'fixture',
      triangleCount: 1,
      compressed: false,
      data: packed,
    },
  ],
};

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2-visibility-test-'));
  csgoDirectory = path.join(temporary, 'steamapps', 'common', 'CS2', 'game', 'csgo');
  cacheDirectory = path.join(temporary, 'derived');
  await fs.mkdir(path.join(csgoDirectory, 'maps'), { recursive: true });
  await fs.writeFile(path.join(csgoDirectory, 'steam.inf'), steamInf);
  await fs.writeFile(path.join(temporary, 'steamapps', 'appmanifest_730.acf'), appManifest);
  await fs.writeFile(path.join(csgoDirectory, 'pak01_dir.vpk'), 'tiny source index marker');
  await fs.writeFile(path.join(csgoDirectory, 'maps', 'de_synthetic.vpk'), 'tiny source map marker');
  failure = undefined;
  spawn.mockReset();
  spawn.mockImplementation((executable: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    child.kill.mockImplementation(() => {
      child.emit('close', 1);
      return true;
    });
    child.stdin.on('finish', () => {
      void (async () => {
        if (executable === 'vrf.exe') {
          if (args[0] === '--version') child.stdout.write('20.0.6980');
          else {
            if (failure === 'export') {
              child.stderr.write('export failed');
              child.emit('close', 1);
              return;
            }
            await fs.writeFile(args[args.indexOf('-o') + 1], 'small synthetic GLB marker');
          }
        } else {
          if (failure === 'worker') {
            child.stderr.write('bake failed');
            child.emit('close', 1);
            return;
          }
          const request = JSON.parse(child.stdin.read().toString()) as { outputCache: string };
          await fs.writeFile(request.outputCache, encodeVisibilityMeshCache(mesh));
          child.stdout.write(JSON.stringify({ sourceAssetHash: mesh.sourceAssetHash, triangleCount: 1 }));
        }
        child.emit('close', 0);
      })().catch((error: unknown) => child.emit('error', error));
    });
    return child;
  });
});

afterEach(async () => {
  const resolved = path.resolve(temporary);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('cs2-visibility-test-')
  )
    throw new Error('Unexpected test directory');
  await fs.rm(resolved, { recursive: true, force: true });
});

function request() {
  return {
    csgoDirectory,
    cacheDirectory,
    mapName: 'de_synthetic',
    demoPatch: 14190,
    vrfExecutable: 'vrf.exe',
    worker: { executable: 'worker.exe', args: [], runAsNode: true },
    signal: new AbortController().signal,
  };
}

describe('installed map provider', () => {
  it('matches only the verified installed patch, client version and Steam build', () => {
    expect(matchVisibilityBuild(14190, steamInf, appManifest)).toEqual({
      demoPatch: 14190,
      installedPatch: 14190,
      clientVersion: 2000930,
      buildId: 25815307,
    });
    expect(matchVisibilityBuild(14189, steamInf, appManifest)).toBeNull();
    expect(matchVisibilityBuild(14190, steamInf.replace('2000930', '2000931'), appManifest)).toBeNull();
    expect(matchVisibilityBuild(14190, steamInf, appManifest.replace('25815307', '25815308'))).toBeNull();
  });

  it('keeps a stable cheap revision and changes it when source assets change or disappear', async () => {
    const original = await readVisibilityMapRevision(csgoDirectory, 'de_synthetic');
    expect(await readVisibilityMapRevision(csgoDirectory, 'de_synthetic')).toBe(original);
    await fs.writeFile(path.join(csgoDirectory, 'maps', 'de_synthetic.vpk'), 'changed source map');
    expect(await readVisibilityMapRevision(csgoDirectory, 'de_synthetic')).not.toBe(original);
    const missing = path.join(temporary, 'missing');
    expect(await readVisibilityMapRevision(missing, 'de_synthetic')).toBe(
      await readVisibilityMapRevision(missing, 'de_synthetic'),
    );
  });

  it('bakes once through a subprocess and reuses its cache without treating the build as a demo hash', async () => {
    const first = await resolveVisibilityMap(request());
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') throw new Error(first.reason);
    expect(first.provenance).toMatchObject({
      matchType: 'installed-build-matched',
      demoFingerprint: null,
      opaqueCoverageComplete: true,
    });
    expect(first.manifest.inventory.vpkSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls[2][2].env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect((await fs.readdir(cacheDirectory)).sort()).toHaveLength(2);
    const second = await resolveVisibilityMap(request());
    expect(second.status).toBe('ready');
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('invalidates a cache after a source change and rebuilds corrupt derived bytes', async () => {
    expect((await resolveVisibilityMap(request())).status).toBe('ready');
    const files = await fs.readdir(cacheDirectory);
    await fs.writeFile(
      path.join(
        cacheDirectory,
        files.find((file) => file.endsWith('.mesh'))!,
      ),
      'corrupt',
    );
    expect((await resolveVisibilityMap(request())).status).toBe('ready');
    expect(spawn).toHaveBeenCalledTimes(6);
    await fs.writeFile(path.join(csgoDirectory, 'maps', 'de_synthetic.vpk'), 'new asset revision');
    expect((await resolveVisibilityMap(request())).status).toBe('ready');
    expect(spawn).toHaveBeenCalledTimes(9);
  });

  it('does not start helpers for unsupported maps, unmatched builds or canceled requests', async () => {
    expect(await resolveVisibilityMap({ ...request(), mapName: '../outside' })).toEqual({
      status: 'unavailable',
      reason: 'unsupported-map-name',
    });
    expect(await resolveVisibilityMap({ ...request(), demoPatch: 14189 })).toEqual({
      status: 'unavailable',
      reason: 'installed-build-mismatch',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(resolveVisibilityMap({ ...request(), signal: controller.signal })).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports individual export and bake failures and removes only its temporary preparation folder', async () => {
    for (const stage of ['export', 'worker'] as const) {
      failure = stage;
      expect((await resolveVisibilityMap(request())).status).toBe('unavailable');
      expect(await fs.readdir(cacheDirectory)).toEqual([]);
    }
  });
});
