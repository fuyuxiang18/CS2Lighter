import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { WebSocketClient } from './web-socket/web-socket-client';

const mocks = vi.hoisted(() => ({
  readDaemonInfoFile: vi.fn(),
  isProcessAlive: vi.fn(),
  hasUpdateShutdownReceipt: vi.fn(),
}));
vi.mock('csdm/node/daemon/daemon-info-file', () => ({ readDaemonInfoFile: mocks.readDaemonInfoFile }));
vi.mock('csdm/node/os/is-process-alive', () => ({ isProcessAlive: mocks.isProcessAlive }));
vi.mock('csdm/node/daemon/update-shutdown-receipt', () => ({
  hasUpdateShutdownReceipt: mocks.hasUpdateShutdownReceipt,
}));
import { prepareUpdateInstall } from './prepare-update-install';

describe('update installation shutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.readDaemonInfoFile.mockResolvedValue({ pid: 42, port: 4574, version: '0.2.0' });
    mocks.isProcessAlive.mockReturnValue(false);
    mocks.hasUpdateShutdownReceipt.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeClient(accepted = true) {
    return { isConnected: true, send: vi.fn().mockResolvedValue(accepted), disconnect: vi.fn() };
  }

  it('leaves the service connected when work prevents shutdown', async () => {
    const client = makeClient(false);
    expect(await prepareUpdateInstall(client as unknown as WebSocketClient)).toBe(false);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(mocks.hasUpdateShutdownReceipt).not.toHaveBeenCalled();
  });

  it('requires the matching clean-shutdown receipt even if the process has exited', async () => {
    mocks.hasUpdateShutdownReceipt.mockResolvedValue(false);
    const client = makeClient();
    await expect(prepareUpdateInstall(client as unknown as WebSocketClient)).rejects.toThrow(
      'shutdown was not confirmed',
    );
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('accepts a clean shutdown only with the nonce sent to this daemon', async () => {
    const client = makeClient();
    expect(await prepareUpdateInstall(client as unknown as WebSocketClient)).toBe(true);
    const nonce = client.send.mock.calls[0][0].payload.nonce;
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.hasUpdateShutdownReceipt).toHaveBeenCalledWith(nonce, 42);
  });
});
