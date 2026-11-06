import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { DeathEvidenceReport } from 'csdm/common/types/death-evidence';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  read: vi.fn(),
  process: vi.fn(),
  checksum: vi.fn(),
  mapRevision: vi.fn(),
  push: vi.fn(),
  matchRevision: 'a'.repeat(64),
}));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }));
vi.mock('csdm/node/demo-cache/cache-directory', () => ({
  getDemoCacheDirectory: () => Promise.resolve({ path: 'D:/synthetic/cache' }),
}));
vi.mock('csdm/node/database/matches/match-import-state', () => ({
  assertMatchImportComplete: () => Promise.resolve(),
}));
vi.mock('csdm/node/database/database', () => ({
  db: {
    selectFrom: () => {
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirstOrThrow: () => Promise.resolve({ demo_path: 'D:/synthetic/missing.dem' }),
      };
      return query;
    },
  },
}));
vi.mock('csdm/node/counter-strike/get-csgo-folder-path', () => ({
  getCsgoFolderPathOrThrow: () => Promise.resolve('D:/synthetic/CS2'),
}));
vi.mock('csdm/node/demo/get-demo-checksum-from-demo-path', () => ({ getDemoChecksumFromDemoPath: mocks.checksum }));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: mocks.push } }));
vi.mock('csdm/server/update-maintenance', () => ({ isUpdateMaintenance: () => false }));
vi.mock('./fetch-death-match', () => ({
  listDeathMatches: () => Promise.resolve([{ checksum: 'abc' }]),
  isDeathMatchCurrent: () => Promise.resolve(true),
}));
vi.mock('./death-review-cache', () => ({
  deathMatchRevision: () => mocks.matchRevision,
  readDeathReviewCache: () =>
    Promise.resolve([{ id: 'first', steamId: '76561198000000001', eventTick: 100, tickrate: 64, mapName: 'de_nuke' }]),
}));
vi.mock('./death-evidence-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./death-evidence-cache')>()),
  readDeathEvidenceCache: mocks.read,
}));
vi.mock('./death-evidence-process', () => ({ runDeathEvidenceProcess: mocks.process }));
// These tests exercise saved-evidence access and source validation only. Keep
// unrelated spatial/weapon providers out of their cold dynamic-import path.
vi.mock('./spray-provider', () => ({ buildSprayProviderEvidence: vi.fn() }));
vi.mock('./gunline-evidence', () => ({ buildGunlineEvidence: vi.fn(), resolveGunlineEntityBounds: vi.fn() }));
vi.mock('./source2-model-resources', () => ({ createSource2ModelResourceResolver: vi.fn() }));
vi.mock('./risk-tactical-provider', () => ({ buildRiskTacticalEvidence: vi.fn() }));
vi.mock('./risk-mechanics-provider', () => ({ buildRiskMechanicsEvidence: vi.fn() }));
vi.mock('./risk-spatial-provider', () => ({ collectSupportTransitions: vi.fn() }));
vi.mock('./cover-proof-provider', () => ({ collectPostKillCoverDepartures: vi.fn() }));
vi.mock('./visibility-map-provider', () => ({
  readVisibilityMapRevision: mocks.mapRevision,
  resolveVisibilityMap: vi.fn(),
}));

const key = { checksum: 'abc', steamId: '76561198000000001', deathId: 'first' };
const saved: DeathEvidenceReport = {
  ...key,
  version: 1,
  matchRevision: mocks.matchRevision,
  generatedAt: '2026-10-12T00:00:00Z',
  startTick: 1,
  endTick: 100,
  deathTick: 100,
  tickrate: 64,
  coverage: { requestedTicks: 100, decodedTicks: 100, missingTicks: 0, shots: 0 },
  geometry: { status: 'available', mapName: 'de_nuke', match: 'installed-build-matched', reasons: [] },
  exposures: [],
  gunlines: [],
  spray: { status: 'evaluated', reasons: [], points: [], findings: [] },
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  mocks.read.mockResolvedValue(saved);
  mocks.mapRevision.mockResolvedValue('updated-installed-map');
});

describe('production saved death evidence access', () => {
  it('uses the match revision fallback after the demo disappears even if the installed map changes', async () => {
    const { deathEvidence } = await import('./death-evidence');
    expect((await deathEvidence.inspect({ ...key, action: 'read' })).report).toEqual(saved);
    expect(mocks.read.mock.calls[0]?.[3]).toBe(mocks.matchRevision);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.checksum).not.toHaveBeenCalled();
  });
  it('keeps saved original-map evidence accessible when the demo is present but CS2 has updated', async () => {
    mocks.stat.mockResolvedValue({ size: 100, mtimeMs: 1, ctimeMs: 2 });
    const historical = { ...saved, loadedFromSavedEvidence: true };
    mocks.read.mockResolvedValue(historical);
    const { deathEvidence } = await import('./death-evidence');
    expect((await deathEvidence.inspect({ ...key, action: 'read' })).report).toEqual(historical);
    expect(mocks.read.mock.calls[0]?.[3]).toBe(mocks.matchRevision);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.checksum).not.toHaveBeenCalled();
  });
  it('reuses saved evidence for an analyze request rather than reparsing solely because CS2 updated', async () => {
    mocks.stat.mockResolvedValue({ size: 100, mtimeMs: 1, ctimeMs: 2 });
    mocks.read.mockResolvedValue({ ...saved, loadedFromSavedEvidence: true });
    const { deathEvidence } = await import('./death-evidence');
    const state = await deathEvidence.inspect({ ...key, action: 'analyze' });
    expect(state.status).toBe('completed');
    expect(state.report).toMatchObject({ loadedFromSavedEvidence: true, geometry: saved.geometry });
    expect(mocks.read.mock.calls[0]?.[3]).toBe(mocks.matchRevision);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.checksum).not.toHaveBeenCalled();
  });
  it('explains the missing demo when a manual refresh is requested and retains the saved report', async () => {
    const { deathEvidence } = await import('./death-evidence');
    await deathEvidence.inspect({ ...key, action: 'refresh' });
    await vi.waitFor(() => expect(deathEvidence.isBusy()).toBe(false));
    expect(mocks.push.mock.calls.at(-1)?.[0].payload).toMatchObject({
      status: 'error',
      report: saved,
      error: expect.stringContaining('original demo file is missing'),
    });
    // A normal read keeps the old evidence available; refresh failure never overwrites it.
    expect((await deathEvidence.inspect({ ...key, action: 'read' })).report).toEqual(saved);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.checksum).not.toHaveBeenCalled();
  });
  it('still enters source validation on explicit refresh and preserves history when new extraction fails', async () => {
    mocks.stat.mockResolvedValue({ size: 100, mtimeMs: 1, ctimeMs: 2 });
    const historical = { ...saved, loadedFromSavedEvidence: true };
    mocks.read.mockResolvedValue(historical);
    mocks.checksum.mockRejectedValueOnce(new Error('The original demo has changed'));
    const { deathEvidence } = await import('./death-evidence');
    await deathEvidence.inspect({ ...key, action: 'refresh' });
    await vi.waitFor(() => expect(deathEvidence.isBusy()).toBe(false));
    expect(mocks.checksum).toHaveBeenCalledOnce();
    expect(mocks.push.mock.calls.at(-1)?.[0].payload).toMatchObject({
      status: 'error',
      report: historical,
      error: 'The original demo has changed',
    });
    expect(mocks.process).not.toHaveBeenCalled();
    expect((await deathEvidence.inspect({ ...key, action: 'read' })).report).toEqual(historical);
  });
  it('does not silently treat a permission error as a missing original', async () => {
    mocks.stat.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const { deathEvidence } = await import('./death-evidence');
    await expect(deathEvidence.inspect({ ...key, action: 'read' })).rejects.toThrow('denied');
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
