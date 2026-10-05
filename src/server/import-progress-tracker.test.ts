import { describe, expect, it } from 'vite-plus/test';
import { ImportProgressTracker } from './import-progress-tracker';

describe('ImportProgressTracker', () => {
  it('releases paused file observations and ignores late observations until resumed', () => {
    const progress = new ImportProgressTracker();
    progress.update('/observed.dem', 'waiting');
    expect(progress.snapshot().isBlocking).toBe(true);
    progress.setQueueState(true, 3);
    expect(progress.snapshot()).toMatchObject({ queuePaused: true, waiting: 0, skipped: 1, isBlocking: false });
    progress.update('/late-stat.dem', 'waiting');
    expect(progress.snapshot()).toMatchObject({ waiting: 0, skipped: 2, isBlocking: false });
    progress.setQueueState(false, 3);
    progress.update('/observed.dem', 'waiting');
    expect(progress.snapshot()).toMatchObject({ queuePaused: false, waiting: 1, isBlocking: true });
  });

  it('preserves real pending work and active insertion when paused observations are released', () => {
    const progress = new ImportProgressTracker();
    progress.update('/observed.dem', 'waiting');
    progress.update('/queued.dem', 'pending');
    progress.update('/saving.dem', 'inserting');
    progress.setQueueState(true, 3);
    expect(progress.snapshot()).toMatchObject({
      waiting: 0,
      skipped: 1,
      pending: 1,
      inserting: 1,
      isBlocking: true,
    });
  });

  it('counts Windows drive and UNC aliases once across scanner, database and manual paths', () => {
    const progress = new ImportProgressTracker();
    progress.beginDiscovery();
    progress.update('D:/cs2demo/Example.dem', 'pending');
    progress.update('d:\\CS2DEMO\\example.dem', 'caching');
    progress.update('\\\\Server\\Share\\Demo.dem', 'pending');
    progress.update('//server/share/demo.dem', 'completed');
    expect(progress.snapshot()).toMatchObject({ total: 2, caching: 1, completed: 1 });
    progress.update('D:\\cs2demo\\EXAMPLE.dem', 'completed');
    progress.finishDiscovery();
    expect(progress.snapshot()).toMatchObject({ total: 2, completed: 2, percent: 100 });
  });
  it('keeps browsing blocked after parsing until insertion has completed', () => {
    const progress = new ImportProgressTracker();
    progress.beginDiscovery();
    progress.update('/a.dem', 'pending');
    progress.update('/b.dem', 'waiting');
    progress.finishDiscovery();
    progress.update('/a.dem', 'analyzing');
    progress.update('/b.dem', 'failed', { reason: 'incomplete' });
    progress.update('/a.dem', 'inserting');
    expect(progress.snapshot()).toMatchObject({ total: 2, settled: 1, completed: 0, percent: 50, isBlocking: true });
    progress.update('/a.dem', 'completed');
    expect(progress.snapshot()).toMatchObject({ completed: 1, failed: 1, percent: 100, isBlocking: false });
  });

  it('does not report 100 percent while discovering more files', () => {
    const progress = new ImportProgressTracker();
    progress.beginDiscovery();
    progress.update('/known.dem', 'skipped', { reason: 'already-imported' });
    expect(progress.snapshot()).toMatchObject({ isBlocking: true, percent: 99 });
    progress.finishDiscovery();
    expect(progress.snapshot()).toMatchObject({ isBlocking: false, percent: 100, skipped: 1, completed: 0 });
  });

  it('settles waiting files when folders are disabled without interrupting active insertion', () => {
    const progress = new ImportProgressTracker();
    progress.update('/pending-copy.dem', 'waiting');
    progress.update('/active.dem', 'inserting');
    progress.settleWaiting('disabled');
    expect(progress.snapshot()).toMatchObject({ waiting: 0, skipped: 1, inserting: 1, isBlocking: true });
    progress.update('/active.dem', 'completed');
    expect(progress.snapshot().isBlocking).toBe(false);
  });

  it('shows deferred unstable files but does not keep the batch locked', () => {
    const progress = new ImportProgressTracker();
    progress.update('/copy.dem', 'waiting');
    progress.update('/copy.dem', 'skipped', { reason: 'unstable', message: 'Still writing' });
    expect(progress.snapshot()).toMatchObject({
      skipped: 1,
      isBlocking: false,
      percent: 100,
      failures: [{ filePath: '/copy.dem', reason: 'unstable' }],
    });
  });

  it('starts a new batch for manual retry after all previous files have settled', () => {
    const progress = new ImportProgressTracker();
    progress.update('/a.dem', 'pending');
    const firstId = progress.snapshot().batchId;
    progress.update('/a.dem', 'failed', { reason: 'analysis' });
    progress.update('/a.dem', 'pending');
    expect(progress.snapshot()).toMatchObject({ total: 1, failed: 0, pending: 1, percent: 0, isBlocking: true });
    expect(progress.snapshot().batchId).not.toBe(firstId);
  });
});
