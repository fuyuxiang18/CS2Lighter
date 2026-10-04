import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ImportProgressTracker } from 'csdm/server/import-progress-tracker';

const mocks = vi.hoisted(() => ({
  descriptor: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  habits: vi.fn(),
  metrics: vi.fn(),
  generation: 0,
}));
vi.mock('./cache-directory', () => ({
  getDemoCacheDirectory: () =>
    Promise.resolve({ path: '/qa/demodata', preferredPath: '/qa/demodata', isFallback: false }),
}));
vi.mock('./demo-cache-descriptor', () => ({ getDemoCacheDescriptor: mocks.descriptor }));
vi.mock('./cache-storage', () => ({
  DEMO_CACHE_SCHEMA_VERSION: 1,
  readCacheFile: mocks.read,
  writeCacheFile: mocks.write,
  deleteCacheFile: mocks.remove,
}));
vi.mock('./build-demo-habits', () => ({ buildDemoHabits: mocks.habits }));
vi.mock('csdm/node/database/personal-stats/compute-personal-match-stats', () => ({
  computePersonalMatchStats: mocks.metrics,
}));
vi.mock('./invalidate-demo-cache', () => ({ getDemoCacheGeneration: () => mocks.generation }));

let service: typeof import('./demo-cache-service');
let progress: ImportProgressTracker;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.generation = 0;
  mocks.descriptor.mockImplementation((checksum: string) =>
    Promise.resolve({ match: { checksum, demoPath: `/${checksum}.dem` }, revision: 'revision-1' }),
  );
  mocks.habits.mockResolvedValue({});
  mocks.metrics.mockResolvedValue([]);
  progress = new ImportProgressTracker();
  const { setDemoCacheProgressListener } = await import('./demo-cache-progress');
  setDemoCacheProgressListener({
    begin: () => progress.beginDiscovery(),
    end: () => progress.finishDiscovery(),
    directory: (value) => progress.setCacheDirectory(value),
    update: (file, status, details) => progress.update(file, status, details),
  });
  service = await import('./demo-cache-service');
});

describe('durable per-demo cache service', () => {
  it('serves a valid cache without scanning positions or recomputing personal facts', async () => {
    mocks.read.mockResolvedValue({ revision: 'revision-1', checksum: 'aa' });
    const result = await service.loadDemoCaches(['aa']);
    expect(result).toHaveLength(1);
    expect(mocks.habits).not.toHaveBeenCalled();
    expect(mocks.metrics).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(progress.snapshot()).toMatchObject({ completed: 1, percent: 100, isBlocking: false });
  });

  it('deduplicates concurrent consumers and rebuilds a stale revision', async () => {
    mocks.read.mockResolvedValue({ revision: 'old' });
    let release: (value: object) => void = () => {};
    mocks.habits.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = service.ensureDemoCache('aa');
    const second = service.ensureDemoCache('aa');
    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.habits).toHaveBeenCalledTimes(1));
    expect(progress.snapshot()).toMatchObject({ caching: 1, completed: 0, isBlocking: true });
    release({});
    await Promise.all([first, second]);
    expect(mocks.metrics).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it('serializes heavy cache builds across different demos', async () => {
    let release: (value: object) => void = () => {};
    mocks.habits.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = service.ensureDemoCache('aa');
    const second = service.ensureDemoCache('bb');
    await vi.waitFor(() => expect(mocks.habits).toHaveBeenCalledTimes(1));
    expect(mocks.habits).toHaveBeenCalledWith(expect.objectContaining({ checksum: 'aa' }));
    release({});
    await Promise.all([first, second]);
    expect(mocks.habits).toHaveBeenCalledTimes(2);
  });

  it('waits for atomic persistence and cross-match aggregation before allowing 100 percent', async () => {
    let finishWrite: () => void = () => {};
    let finishProfile: () => void = () => {};
    mocks.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const aggregate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishProfile = resolve;
        }),
    );
    const run = service.loadDemoCaches(['aa'], aggregate);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(progress.snapshot()).toMatchObject({ caching: 1, completed: 0, isBlocking: true });
    finishWrite();
    await vi.waitFor(() => expect(aggregate).toHaveBeenCalledTimes(1));
    expect(progress.snapshot()).toMatchObject({
      profiling: 1,
      completed: 0,
      isBlocking: true,
      currentFiles: [{ index: 1 }],
    });
    finishProfile();
    await run;
    expect(progress.snapshot()).toMatchObject({ completed: 1, percent: 100, isBlocking: false });
  });

  it('does not unlock when another consumer of the same demo is still merging', async () => {
    mocks.read.mockResolvedValue({ revision: 'revision-1', checksum: 'aa' });
    let finish: () => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = service.loadDemoCaches(['aa'], slow);
    const second = service.loadDemoCaches(['aa']);
    await second;
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    expect(progress.snapshot().isBlocking).toBe(true);
    expect(progress.snapshot().percent).toBeLessThan(100);
    finish();
    await first;
    expect(progress.snapshot()).toMatchObject({ isBlocking: false, percent: 100 });
  });

  it('records cache failures and retries from the database without invoking an analyzer', async () => {
    mocks.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.loadDemoCaches(['aa', 'bb'])).rejects.toThrow('disk full');
    expect(progress.snapshot()).toMatchObject({
      completed: 1,
      failed: 1,
      isBlocking: false,
      failures: [{ reason: 'cache' }],
    });
    expect(service.getDemoCacheFailures().get('/aa.dem')?.checksum).toBe('aa');
    await service.retryFailedDemoCaches();
    expect(service.getDemoCacheFailures().size).toBe(0);
    expect(progress.snapshot()).toMatchObject({ completed: 1, failed: 0, isBlocking: false });
  });

  it('never writes a result invalidated during aggregation or resurrects a deleted match after rename', async () => {
    mocks.habits.mockImplementationOnce(() => {
      mocks.generation++;
      return Promise.resolve({});
    });
    await expect(service.ensureDemoCache('aa')).rejects.toThrow('changed');
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.write.mockImplementationOnce(() => {
      mocks.generation++;
      return Promise.resolve();
    });
    await expect(service.ensureDemoCache('bb')).rejects.toThrow('removed');
    expect(mocks.remove).toHaveBeenCalledWith('/qa/demodata', 'bb');
  });

  it('does not leave files pending if a requested match was removed before descriptor discovery', async () => {
    mocks.descriptor.mockRejectedValueOnce(new Error('removed'));
    await expect(service.loadDemoCaches(['aa', 'bb'])).rejects.toThrow('removed');
    expect(progress.snapshot().isBlocking).toBe(false);
  });
  it('can retry a temporary metadata failure after insertion using only the database', async () => {
    mocks.descriptor.mockRejectedValueOnce(new Error('temporary connection problem'));
    await expect(service.ensureDemoCache('aa', '/aa.dem')).rejects.toThrow('connection');
    expect(service.getDemoCacheFailures().get('/aa.dem')?.checksum).toBe('aa');
    await service.retryFailedDemoCaches();
    expect(service.getDemoCacheFailures().size).toBe(0);
    expect(progress.snapshot()).toMatchObject({ completed: 1, isBlocking: false });
  });
});
