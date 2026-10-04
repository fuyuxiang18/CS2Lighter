import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Analysis } from 'csdm/common/types/analysis';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readJson: vi.fn(),
  outputJson: vi.fn(),
  move: vi.fn(),
  glob: vi.fn(),
  complete: vi.fn(),
  settings: { folders: [{ path: '/library', includeSubFolders: true }], analyze: { autoAnalyzeFolders: true } },
  analyses: [] as Analysis[],
  add: vi.fn(),
  completion: undefined as ((analysis: Analysis) => void) | undefined,
}));
vi.mock('fs-extra', () => ({
  default: { stat: mocks.stat, readJson: mocks.readJson, outputJson: mocks.outputJson, move: mocks.move },
}));
vi.mock('csdm/node/settings/get-settings', () => ({ getSettings: () => Promise.resolve(mocks.settings) }));
vi.mock('csdm/node/filesystem/glob', () => ({ glob: mocks.glob }));
vi.mock('csdm/node/filesystem/get-app-folder-path', () => ({ getAppFolderPath: () => '/profile' }));
vi.mock('csdm/node/demo/get-demo-from-file-path', () => ({
  getDemoFromFilePath: (filePath: string) => Promise.resolve({ filePath, checksum: 'one-recording' }),
}));
vi.mock('csdm/node/demo/has-complete-source2-demo', () => ({ hasCompleteSource2Demo: mocks.complete }));
vi.mock('csdm/node/database/matches/fetch-match-checksums', () => ({ fetchMatchChecksums: () => Promise.resolve([]) }));
vi.mock('csdm/node/database/database', () => ({ isDatabaseConnected: () => true }));
vi.mock('csdm/server/update-maintenance', () => ({ isUpdateMaintenance: () => false }));
vi.mock('csdm/node/demo-cache/demo-cache-service', () => ({
  getDemoCacheFailures: () => new Map(),
  retryFailedDemoCaches: () => Promise.resolve(),
}));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: vi.fn() } }));
vi.mock('csdm/server/analyses-listener', () => ({
  analysesListener: {
    getAnalyses: () => mocks.analyses,
    addDemosToAnalyses: mocks.add,
    onAnalysisCompleted: (fn: (analysis: Analysis) => void) => {
      mocks.completion = fn;
      return () => {
        mocks.completion = undefined;
      };
    },
  },
}));
vi.stubGlobal('logger', { log: vi.fn(), warn: vi.fn(), error: vi.fn() });

let watcher: typeof import('./auto-import-demo-folders');
let progress: (typeof import('../import-progress'))['importProgress'];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.clearAllMocks();
  mocks.settings = { folders: [{ path: '/library', includeSubFolders: true }], analyze: { autoAnalyzeFolders: true } };
  mocks.analyses = [];
  mocks.glob.mockResolvedValue(['/library/one.dem']);
  mocks.stat.mockResolvedValue({ size: 100, mtimeMs: 0, isFile: () => true });
  mocks.readJson.mockRejectedValue({ code: 'ENOENT' });
  mocks.complete.mockResolvedValue(true);
  mocks.add.mockImplementation((demos: { filePath: string; checksum: string }[]) => {
    mocks.analyses.push(...demos.map((demo) => ({ demoPath: demo.filePath, demoChecksum: demo.checksum }) as Analysis));
    return Promise.resolve();
  });
  watcher = await import('./auto-import-demo-folders');
  progress = (await import('../import-progress')).importProgress;
});

afterEach(() => {
  watcher.stopAutoImportDemoFolders();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('automatic folder import progress', () => {
  it('discovers the startup batch before parsing and keeps a duplicate copy out of the queue', async () => {
    mocks.glob.mockResolvedValue(['/library/one.dem', '/library/nested/copy.dem']);
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.snapshot()).toMatchObject({ total: 2, waiting: 2, isBlocking: true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(progress.snapshot()).toMatchObject({ total: 2, pending: 1, skipped: 1, isBlocking: true });
  });

  it('makes incomplete files visible as failed, unlocks browsing, and retries explicitly without modifying files', async () => {
    mocks.complete.mockResolvedValue(false);
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(10000);
    expect(progress.snapshot()).toMatchObject({
      failed: 1,
      isBlocking: false,
      percent: 100,
      failures: [{ reason: 'incomplete' }],
    });
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.complete.mockResolvedValue(true);
    mocks.settings.analyze.autoAnalyzeFolders = false;
    await watcher.retryFailedImports();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(progress.snapshot()).toMatchObject({ pending: 1, failed: 0, isBlocking: true });
  });

  it('bounds blocking for a continuously growing file and imports once it becomes stable', async () => {
    mocks.stat.mockImplementation(() =>
      Promise.resolve({ size: 100 + Date.now(), mtimeMs: Date.now(), isFile: () => true }),
    );
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(20000);
    expect(progress.snapshot()).toMatchObject({
      skipped: 1,
      waiting: 0,
      isBlocking: false,
      failures: [{ reason: 'unstable' }],
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect(progress.snapshot().isBlocking).toBe(false);
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.stat.mockResolvedValue({ size: 35100, mtimeMs: 35000, isFile: () => true });
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(progress.snapshot().isBlocking).toBe(true);
  });

  it('releases waiting files when automatic analysis is switched off', async () => {
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.snapshot().isBlocking).toBe(true);
    mocks.settings.analyze.autoAnalyzeFolders = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress.snapshot()).toMatchObject({ skipped: 1, isBlocking: false });
    mocks.settings.analyze.autoAnalyzeFolders = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(progress.snapshot()).toMatchObject({ waiting: 1, isBlocking: true });
  });

  it('settles duplicate files during an explicit retry rather than leaving them pending forever', async () => {
    mocks.glob.mockResolvedValue(['/library/one.dem', '/library/nested/copy.dem']);
    mocks.complete.mockResolvedValue(false);
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(10000);
    expect(progress.snapshot().failed).toBe(2);
    mocks.complete.mockResolvedValue(true);
    await watcher.retryFailedImports();
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(progress.snapshot()).toMatchObject({ total: 2, pending: 1, skipped: 1, failed: 0 });
  });

  it('does not unlock when the same file is queued manually while retry preflight is running', async () => {
    mocks.complete.mockResolvedValue(false);
    watcher.startAutoImportDemoFolders();
    await vi.advanceTimersByTimeAsync(10000);
    const filePath = progress.snapshot().failures[0].filePath;
    let finishCheck: (value: boolean) => void = () => {};
    mocks.complete.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        }),
    );
    const retry = watcher.retryFailedImports();
    await vi.advanceTimersByTimeAsync(0);
    mocks.analyses.push({ demoPath: filePath, demoChecksum: 'one-recording' } as Analysis);
    progress.update(filePath, 'analyzing');
    finishCheck(true);
    await retry;
    expect(progress.snapshot()).toMatchObject({ analyzing: 1, skipped: 0, isBlocking: true });
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
