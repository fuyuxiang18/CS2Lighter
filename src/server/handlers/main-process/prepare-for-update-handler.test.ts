import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  busy: vi.fn(),
  requests: vi.fn(),
  cli: vi.fn(),
  game: vi.fn(),
  maintain: vi.fn(),
  stop: vi.fn(),
  exit: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock('csdm/server/idle-monitor/idle-monitor', () => ({ hasWorkInProgress: mocks.busy }));
vi.mock('csdm/server/start-background-tasks', () => ({ stopBackgroundTasks: mocks.stop }));
vi.mock('csdm/server/exit-daemon', () => ({ exitDaemon: mocks.exit }));
vi.mock('csdm/node/daemon/update-shutdown-receipt', () => ({ writeUpdateShutdownReceipt: mocks.receipt }));
vi.mock('csdm/server/update-maintenance', () => ({ enterUpdateMaintenance: mocks.maintain }));
vi.mock('csdm/server/server', () => ({
  getActiveRequestCount: mocks.requests,
  server: { getCliClientCount: mocks.cli, isGameConnected: mocks.game },
}));

const { prepareForUpdateHandler } = await import('./prepare-for-update-handler');
const request = { nonce: 'a7777777-7777-4777-a777-777777777777' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.busy.mockReturnValue(false);
  mocks.requests.mockReturnValue(0);
  mocks.cli.mockReturnValue(0);
  mocks.game.mockReturnValue(false);
  mocks.exit.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('prepareForUpdateHandler', () => {
  it.each(['busy', 'requests', 'cli', 'game'] as const)(
    'refuses restart while %s work is present without stopping background work',
    async (reason) => {
      mocks[reason].mockReturnValue(reason === 'cli' || reason === 'requests' ? 1 : true);
      expect(await prepareForUpdateHandler(request)).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(mocks.maintain).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
      expect(mocks.exit).not.toHaveBeenCalled();
    },
  );

  it('enters maintenance and stops discovery before accepting, then exits after the reply can be delivered', async () => {
    expect(await prepareForUpdateHandler(request)).toBe(true);
    expect(mocks.maintain).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.maintain.mock.invocationCallOrder[0]).toBeLessThan(mocks.stop.mock.invocationCallOrder[0]);
    await vi.advanceTimersByTimeAsync(99);
    expect(mocks.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.exit).toHaveBeenCalledTimes(1);
    expect(mocks.exit).toHaveBeenCalledWith(0, expect.any(Function));
    expect(mocks.receipt).not.toHaveBeenCalled();
    const onCleanExit = mocks.exit.mock.calls[0][1] as () => Promise<void>;
    await onCleanExit();
    expect(mocks.receipt).toHaveBeenCalledWith(request.nonce);
  });

  it('rejects an invalid shutdown receipt nonce without entering maintenance', async () => {
    expect(await prepareForUpdateHandler({ nonce: 'not-a-uuid' })).toBe(false);
    expect(mocks.maintain).not.toHaveBeenCalled();
    expect(mocks.exit).not.toHaveBeenCalled();
  });
});
