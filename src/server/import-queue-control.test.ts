import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { normalizeDemoPath } from 'csdm/common/normalize-demo-path';
import { getDemoFileFingerprint } from './tasks/demo-file-readiness';

const context = vi.hoisted(() => ({ folder: '' }));
vi.mock('csdm/node/filesystem/get-app-folder-path', () => ({ getAppFolderPath: () => context.folder }));
vi.stubGlobal('logger', { error: vi.fn() });
beforeEach(async () => {
  vi.resetModules();
  context.folder = await mkdtemp(path.join(os.tmpdir(), 'cs2-import-controls-'));
});
afterEach(async () => {
  if (
    path.dirname(context.folder) !== path.resolve(os.tmpdir()) ||
    !path.basename(context.folder).startsWith('cs2-import-controls-')
  )
    throw new Error('Invalid test cleanup path');
  await rm(context.folder, { recursive: true, force: true });
});

describe('durable import queue controls', () => {
  it('restores pause and removed-file suppression after restart, with explicit selection restoring eligibility', async () => {
    const file = path.join(context.folder, 'sample.dem');
    await writeFile(file, 'fixture');
    const control = await import('./import-queue-control');
    await control.setImportQueuePaused(true);
    await control.suppressDemoImport(file);
    const fingerprint = getDemoFileFingerprint(await stat(file));
    vi.resetModules();
    const restored = await import('./import-queue-control');
    expect(await restored.getImportQueueControl()).toEqual({
      paused: true,
      suppressed: { [normalizeDemoPath(file)]: fingerprint },
      suppressedChecksums: {},
    });
    await restored.allowDemoImport(file);
    await restored.setImportQueuePaused(false);
    expect(JSON.parse(await readFile(path.join(context.folder, 'import-queue-control.json'), 'utf8'))).toEqual({
      paused: false,
      suppressed: {},
      suppressedChecksums: {},
    });
  });

  it('does not suppress a newly changed recording and serializes concurrent updates without losing entries', async () => {
    const one = path.join(context.folder, 'one.dem');
    const two = path.join(context.folder, 'two.dem');
    await Promise.all([writeFile(one, 'one'), writeFile(two, 'two')]);
    const control = await import('./import-queue-control');
    await Promise.all([
      control.suppressDemoImport(one),
      control.suppressDemoImport(two),
      control.setImportQueuePaused(true),
    ]);
    await writeFile(one, 'changed recording');
    const saved = JSON.parse(await readFile(path.join(context.folder, 'import-queue-control.json'), 'utf8'));
    expect(Object.keys(saved.suppressed)).toHaveLength(2);
    expect(saved.paused).toBe(true);
    expect(saved.suppressed[normalizeDemoPath(one)]).not.toBe(getDemoFileFingerprint(await stat(one)));
  });

  it('restores recording-wide cancellation and allows every copy when any copy is explicitly selected', async () => {
    const original = path.join(context.folder, 'original.dem');
    const copy = path.join(context.folder, 'other-folder', 'copy.dem');
    const control = await import('./import-queue-control');
    // Checksum cancellation also survives a moved or removed source; no demo read is required.
    await control.suppressDemoImport(original, 'a11ce');
    await control.suppressDemoImport(copy, 'a11ce');
    vi.resetModules();
    const restored = await import('./import-queue-control');
    const state = await restored.getImportQueueControl();
    expect(state.suppressedChecksums).toEqual({ a11ce: true });
    expect(state.suppressed).toEqual({});
    expect(state.suppressedChecksums['b22ce']).toBeUndefined();
    await restored.allowDemoImport(copy, 'a11ce');
    vi.resetModules();
    const allowed = await import('./import-queue-control');
    expect((await allowed.getImportQueueControl()).suppressedChecksums).toEqual({});
  });

  it('loads legacy path-only controls without dropping their pause or suppression', async () => {
    const original = normalizeDemoPath(path.join(context.folder, 'legacy.dem'));
    await writeFile(
      path.join(context.folder, 'import-queue-control.json'),
      JSON.stringify({ paused: true, suppressed: { [original]: '100:200' } }),
    );
    const control = await import('./import-queue-control');
    expect(await control.getImportQueueControl()).toEqual({
      paused: true,
      suppressed: { [original]: '100:200' },
      suppressedChecksums: {},
    });
  });
});
