import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { IPCChannel } from 'csdm/common/ipc-channel';
import type { AppUpdateState } from 'csdm/common/types/app-update';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  send: vi.fn(),
  app: { isPackaged: true, once: vi.fn() },
  prepare: vi.fn(),
}));
const updater = Object.assign(new EventEmitter(), {
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn(),
  autoInstallOnAppQuit: true,
  autoDownload: true,
  allowDowngrade: true,
});
vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) },
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));
vi.mock('./window-manager', () => ({
  windowManager: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: mocks.send } }) },
}));

async function invoke(name: IPCChannel): Promise<AppUpdateState> {
  return (await mocks.handlers.get(name)?.()) as AppUpdateState;
}

describe('application updater', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updater.removeAllListeners();
    mocks.handlers.clear();
    vi.stubGlobal('logger', { log: vi.fn(), warn: vi.fn(), error: vi.fn() });
    mocks.app.isPackaged = true;
    mocks.prepare.mockResolvedValue(true);
    updater.downloadUpdate.mockResolvedValue([]);
    const { initialize } = await import('./auto-updater');
    initialize(false, mocks.prepare);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never installs on an ordinary quit or before a verified download', async () => {
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    await invoke(IPCChannel.InstallUpdate);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the downloaded update when parsing prevents a restart, then installs after shutdown', async () => {
    updater.emit('update-downloaded', { version: '0.3.0' });
    mocks.prepare.mockResolvedValueOnce(false);
    expect(await invoke(IPCChannel.InstallUpdate)).toMatchObject({
      status: 'downloaded',
      downloaded: true,
      error: 'busy',
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await invoke(IPCChannel.InstallUpdate);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it('reports a download failure and allows retry without installing', async () => {
    updater.emit('update-available', { version: '0.3.0' });
    updater.downloadUpdate.mockRejectedValueOnce(new Error('offline'));
    expect(await invoke(IPCChannel.DownloadUpdate)).toMatchObject({
      status: 'error',
      error: 'network',
      downloaded: false,
    });
    await invoke(IPCChannel.InstallUpdate);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await invoke(IPCChannel.DownloadUpdate);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not install when database shutdown fails', async () => {
    updater.emit('update-downloaded', { version: '0.3.0' });
    mocks.prepare.mockRejectedValueOnce(new Error('shutdown failed'));
    expect(await invoke(IPCChannel.InstallUpdate)).toMatchObject({
      status: 'error',
      error: 'install',
      downloaded: true,
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
