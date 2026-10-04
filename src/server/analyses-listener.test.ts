import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Demo } from 'csdm/common/types/demo';
import { DemoSource } from 'csdm/common/types/counter-strike';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';
import { CorruptedDemoError } from 'csdm/node/demo-analyzer/corrupted-demo-error';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  insert: vi.fn(),
  cache: vi.fn(),
  push: vi.fn(),
  maintenance: vi.fn(() => false),
}));
vi.mock('csdm/node/demo-cache/demo-cache-service', () => ({ ensureDemoCache: mocks.cache }));
vi.mock('csdm/server/update-maintenance', () => ({ isUpdateMaintenance: mocks.maintenance }));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: mocks.push } }));
vi.mock('csdm/node/demo/analyze-demo', () => ({ analyzeDemo: mocks.analyze }));
vi.mock('csdm/node/database/matches/process-match-insertion', () => ({ processMatchInsertion: mocks.insert }));
vi.mock('csdm/node/settings/get-settings', () => ({
  getSettings: () => Promise.resolve({ analyze: { maxConcurrentAnalyses: 2, analyzePositions: true } }),
}));
vi.stubGlobal('logger', { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() });

const { analysesListener } = await import('./analyses-listener');
const { importProgress } = await import('./import-progress');
const demo = {
  checksum: 'recording-one',
  filePath: '/demos/complete.dem',
  mapName: 'de_mirage',
  source: DemoSource.PerfectWorld,
} as Demo;

beforeEach(() => {
  analysesListener.clear();
  vi.clearAllMocks();
});

describe('analysesListener automatic imports', () => {
  it('keeps progress below 100 until the database insert promise resolves', async () => {
    let finishInsert: () => void = () => {};
    mocks.analyze.mockResolvedValueOnce(undefined);
    mocks.insert.mockImplementationOnce(() => new Promise<void>((resolve) => (finishInsert = resolve)));
    const run = analysesListener.addDemosToAnalyses([demo]);
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    expect(importProgress.snapshot()).toMatchObject({ inserting: 1, completed: 0, isBlocking: true });
    expect(importProgress.snapshot().percent).toBeLessThan(100);
    finishInsert();
    await run;
    expect(importProgress.snapshot()).toMatchObject({ completed: 1, percent: 100, isBlocking: false });
  });

  it('rejects new work during update maintenance before starting the analyzer', async () => {
    mocks.maintenance.mockReturnValueOnce(true);
    await expect(analysesListener.addDemosToAnalyses([demo])).rejects.toThrow('update');
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('keeps browsing blocked after insertion until the durable cache is saved', async () => {
    let finishCache: () => void = () => {};
    mocks.analyze.mockResolvedValueOnce(undefined);
    mocks.insert.mockResolvedValueOnce({});
    mocks.cache.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCache = resolve;
        }),
    );
    const run = analysesListener.addDemosToAnalyses([demo]);
    await vi.waitFor(() => expect(mocks.cache).toHaveBeenCalledTimes(1));
    expect(importProgress.snapshot()).toMatchObject({ caching: 1, completed: 0, isBlocking: true });
    expect(importProgress.snapshot().percent).toBeLessThan(100);
    finishCache();
    await run;
    expect(importProgress.snapshot()).toMatchObject({ completed: 1, percent: 100, isBlocking: false });
  });
  it('does not unlock if a concurrent profile read completes an old cache during manual reanalysis', async () => {
    let finishAnalysis: () => void = () => {};
    mocks.analyze.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAnalysis = resolve;
        }),
    );
    const run = analysesListener.addDemosToAnalyses([demo]);
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    importProgress.beginDiscovery();
    importProgress.update(demo.filePath, 'profiling');
    importProgress.update(demo.filePath, 'completed');
    importProgress.finishDiscovery();
    expect(importProgress.snapshot().isBlocking).toBe(true);
    expect(importProgress.snapshot().percent).toBeLessThan(100);
    finishAnalysis();
    await run;
    expect(importProgress.snapshot()).toMatchObject({ isBlocking: false, percent: 100 });
  });
  it('keeps an inserted match and reports a separate retriable cache failure', async () => {
    mocks.analyze.mockResolvedValueOnce(undefined);
    mocks.insert.mockResolvedValueOnce({});
    mocks.cache.mockRejectedValueOnce(new Error('cache disk full'));
    const completed = vi.fn();
    const unsubscribe = analysesListener.onAnalysisCompleted(completed);
    try {
      await analysesListener.addDemosToAnalyses([demo]);
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({ status: AnalysisStatus.InsertSuccess, cacheError: 'cache disk full' }),
      );
      expect(importProgress.snapshot()).toMatchObject({
        failed: 1,
        completed: 0,
        isBlocking: false,
        failures: [{ reason: 'cache' }],
      });
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
  it('queues identical copies only once when they arrive in the same batch', async () => {
    mocks.analyze.mockResolvedValueOnce(undefined);
    await analysesListener.addDemosToAnalyses([demo, { ...demo, filePath: '/another/copy.dem' }]);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue an identical recording while its analysis is already running', async () => {
    let finish: () => void = () => {};
    mocks.analyze.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const firstRun = analysesListener.addDemosToAnalyses([demo]);
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    await analysesListener.addDemosToAnalyses([{ ...demo, filePath: '/another/copy.dem' }]);
    expect(analysesListener.getAnalyses()).toHaveLength(1);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    finish();
    await firstRun;
  });

  it('does not insert partial results when an automatic import reports corruption', async () => {
    mocks.analyze.mockRejectedValueOnce(new CorruptedDemoError());
    const completed = vi.fn();
    const unsubscribe = analysesListener.onAnalysisCompleted(completed);
    try {
      await analysesListener.addDemosToAnalyses([demo], { analyzePositions: true, allowCorrupted: false });
      expect(mocks.insert).not.toHaveBeenCalled();
      expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: AnalysisStatus.AnalyzeError }));
      expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ analyzePositions: true }));
    } finally {
      unsubscribe();
    }
  });

  it('keeps the existing manual recovery behavior for corrupt recordings', async () => {
    mocks.analyze.mockRejectedValueOnce(new CorruptedDemoError());
    await analysesListener.addDemosToAnalyses([demo]);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});
