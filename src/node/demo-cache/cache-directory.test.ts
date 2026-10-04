import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { chooseDemoCacheDirectory } from './cache-directory';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'cs2-cache-directory-test-'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (
    path.dirname(folder) !== path.resolve(os.tmpdir()) ||
    !path.basename(folder).startsWith('cs2-cache-directory-test-')
  )
    throw new Error('Invalid cleanup path');
  await rm(folder, { recursive: true, force: true });
});
describe('cache directory selection', () => {
  it('prefers the writable install directory and leaves no write probes', async () => {
    const preferred = path.join(folder, 'install', 'demodata');
    expect(await chooseDemoCacheDirectory(preferred, path.join(folder, 'profile'))).toEqual({
      path: preferred,
      preferredPath: preferred,
      isFallback: false,
    });
    expect(await readdir(preferred)).toEqual([]);
  });
  it('reports the actual fallback and original error when installation storage is unavailable', async () => {
    const preferred = path.join(folder, 'blocked');
    await writeFile(preferred, 'existing file');
    const fallback = path.join(folder, 'profile', 'demodata');
    expect(await chooseDemoCacheDirectory(preferred, fallback)).toMatchObject({
      path: fallback,
      preferredPath: preferred,
      isFallback: true,
      reason: expect.any(String),
    });
    expect(await readdir(fallback)).toEqual([]);
  });
  it('forces an explicit QA profile even in production mode', async () => {
    vi.resetModules();
    vi.stubGlobal('IS_DEV', false);
    vi.stubEnv('CS2_PARSER_DATA_DIR', folder);
    const { getDemoCacheDirectory } = await import('./cache-directory');
    expect(await getDemoCacheDirectory()).toEqual({
      path: path.join(folder, 'demodata'),
      preferredPath: path.join(folder, 'demodata'),
      isFallback: false,
    });
    expect(await readdir(folder)).toEqual(['demodata']);
  });
});
