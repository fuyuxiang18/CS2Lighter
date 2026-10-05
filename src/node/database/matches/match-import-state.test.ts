import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test';
const fixture = vi.hoisted(() => ({ folder: '' }));
vi.mock('csdm/node/filesystem/get-app-folder-path', () => ({ getAppFolderPath: () => fixture.folder }));
beforeEach(async () => {
  vi.resetModules();
  fixture.folder = await mkdtemp(path.join(os.tmpdir(), 'cs2-match-import-'));
});
afterEach(async () => {
  if (
    path.dirname(fixture.folder) !== path.resolve(os.tmpdir()) ||
    !path.basename(fixture.folder).startsWith('cs2-match-import-')
  )
    throw new Error('Invalid fixture path');
  await rm(fixture.folder, { recursive: true, force: true });
});
describe('durable match publication barrier', () => {
  it('rejects incomplete match data across a process restart without invalidating untouched matches', async () => {
    const first = await import('./match-import-state');
    await first.beginMatchImport('aa', 'D:/fixture.dem');
    expect(first.isMatchImportActive('aa')).toBe(true);
    await expect(first.assertMatchImportComplete('aa')).rejects.toThrow('still being saved');
    await expect(first.clearIncompleteMatchImports(['aa'])).rejects.toThrow('still being saved');
    await expect(first.assertMatchImportComplete('bb')).resolves.toBeUndefined();
    vi.resetModules();
    const restarted = await import('./match-import-state');
    expect(restarted.isMatchImportActive('aa')).toBe(false);
    await expect(restarted.assertMatchImportComplete('aa')).rejects.toThrow('interrupted');
    await restarted.beginMatchImport('aa', 'D:/fixture.dem');
    await restarted.completeMatchImport('aa');
    await expect(restarted.assertMatchImportComplete('aa')).resolves.toBeUndefined();
    expect(await readdir(path.join(fixture.folder, 'incomplete-match-imports'))).toEqual([]);
  });
  it('retains a failed import until explicit retry or match deletion clears its marker', async () => {
    const state = await import('./match-import-state');
    await state.beginMatchImport('aa', 'D:/fixture.dem');
    await state.failMatchImport('aa');
    expect(state.isMatchImportActive('aa')).toBe(false);
    expect((await state.getIncompleteMatchImports()).get('aa')?.status).toBe('failed');
    await expect(state.assertMatchImportComplete('aa')).rejects.toThrow();
    await state.clearIncompleteMatchImports(['aa']);
    await expect(state.assertMatchImportComplete('aa')).resolves.toBeUndefined();
  });
});
