import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
const mocks = vi.hoisted(() => ({ demos: vi.fn(), orphanPaths: vi.fn(), push: vi.fn() }));
vi.mock('csdm/node/database/demos/delete-demos', () => ({ deleteDemos: mocks.demos }));
vi.mock('csdm/node/database/demos/delete-orphan-demo-paths', () => ({ deleteOrphanDemoPaths: mocks.orphanPaths }));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: mocks.push } }));
vi.stubGlobal('logger', { error: vi.fn() });
import { optimizeDatabaseHandler } from './optimize-database-handler';
beforeEach(() => vi.clearAllMocks());
describe('library cleanup preserves imported trajectories', () => {
  it('rejects a legacy clearPositions payload before performing any cleanup', async () => {
    const legacy = { clearPositions: true, clearDemos: true, clearOrphanDemos: true };
    await expect(optimizeDatabaseHandler(legacy)).rejects.toContain('no longer supported');
    expect(mocks.demos).not.toHaveBeenCalled();
    expect(mocks.orphanPaths).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('limits supported cleanup to unavailable file references or unimported metadata', async () => {
    await optimizeDatabaseHandler({ clearDemos: false, clearOrphanDemos: true });
    expect(mocks.orphanPaths).toHaveBeenCalledTimes(1);
    expect(mocks.demos).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
