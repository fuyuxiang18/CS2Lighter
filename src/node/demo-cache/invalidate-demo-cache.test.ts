import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getDemoCacheGeneration, writeWithDemoCacheGeneration } from './cache-generation';
import { invalidateDemoCaches } from './invalidate-demo-cache';

const mocks = vi.hoisted(() => ({ directory: '' }));
vi.mock('./cache-directory', () => ({ getDemoCacheDirectory: () => Promise.resolve({ path: mocks.directory }) }));

beforeEach(async () => {
  mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'cs2-cache-invalidate-'));
  await Promise.all(['death-review', 'death-evidence'].map((name) => mkdir(path.join(mocks.directory, name))));
  vi.stubGlobal('logger', { error: vi.fn() });
});
afterEach(async () => {
  const resolved = path.resolve(mocks.directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('cs2-cache-invalidate-')
  )
    throw new Error('Unsafe cache fixture cleanup');
  await rm(resolved, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function files(checksum: string) {
  return [`${checksum}.json`, `death-review/${checksum}.json`, `death-evidence/${checksum}.json.gz`].map((file) =>
    path.join(mocks.directory, file),
  );
}

describe('demo cache invalidation', () => {
  it('removes all three selected derived files without touching another match', async () => {
    await Promise.all([...files('abc'), ...files('def')].map((file) => writeFile(file, 'saved')));
    const generation = getDemoCacheGeneration('abc');
    await invalidateDemoCaches(['abc', 'abc']);
    expect(getDemoCacheGeneration('abc')).toBe(generation + 1);
    for (const file of files('abc')) await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const file of files('def')) expect(await readFile(file, 'utf8')).toBe('saved');
  });
  it('waits for an in-flight writer then removes its late files, and refuses stale new writes', async () => {
    const generation = getDemoCacheGeneration('abc');
    let release: (() => void) | undefined;
    const pending = writeWithDemoCacheGeneration('abc', generation, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await Promise.all(files('abc').map((file) => writeFile(file, 'late result')));
    });
    const rejected = expect(pending).rejects.toThrow('invalidated');
    await vi.waitFor(() => expect(release).toBeDefined());
    let removed = false;
    const invalidation = invalidateDemoCaches(['abc']).then(() => {
      removed = true;
    });
    await expect(writeWithDemoCacheGeneration('abc', generation, () => Promise.resolve())).rejects.toThrow(
      'invalidated',
    );
    expect(removed).toBe(false);
    release!();
    await Promise.all([rejected, invalidation]);
    for (const file of files('abc')) await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeWithDemoCacheGeneration('abc', getDemoCacheGeneration('abc'), () =>
      writeFile(files('abc')[0], 'new generation'),
    );
    expect(await readFile(files('abc')[0], 'utf8')).toBe('new generation');
  });
  it('validates every checksum before removing files or changing generations', async () => {
    await writeFile(files('abc')[0], 'saved');
    const generation = getDemoCacheGeneration('abc');
    await expect(invalidateDemoCaches(['abc', '../outside'])).rejects.toThrow('checksum');
    expect(getDemoCacheGeneration('abc')).toBe(generation);
    expect(await readdir(mocks.directory)).toContain('abc.json');
  });
});
