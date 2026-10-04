import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { windowManager } from './window-manager';
import { IPCChannel } from 'csdm/common/ipc-channel';
import type { AppUpdateState } from 'csdm/common/types/app-update';

export function initialize(autoDownloadUpdates: boolean, prepareForInstall: () => Promise<boolean>) {
  autoUpdater.logger = {
    error: logger.error,
    info: logger.log,
    warn: logger.warn,
    debug: logger.log,
  };
  autoUpdater.disableWebInstaller = true;
  autoUpdater.autoDownload = false;
  // Only the explicit restart button may install: the daemon must close PostgreSQL first.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  let shouldDownloadAutomatically = autoDownloadUpdates;
  let state: AppUpdateState = {
    status: app.isPackaged ? 'idle' : 'unavailable',
    version: null,
    percent: 0,
    downloaded: false,
    error: null,
  };

  // For local release QA only. Normal builds use the packaged GitHub app-update.yml.
  const testFeed = process.env.CS2_PARSER_UPDATE_FEED_URL;
  if (testFeed && process.env.CS2_PARSER_DATA_DIR) {
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeed });
  }

  const publish = (patch: Partial<AppUpdateState>) => {
    state = { ...state, ...patch };
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPCChannel.UpdateStateChanged, state);
    }
  };
  const fail = (error: unknown, kind: AppUpdateState['error'] = 'network') => {
    logger.error(error);
    publish({ status: 'error', error: kind });
  };

  const download = async () => {
    if (
      !app.isPackaged ||
      !state.version ||
      state.downloaded ||
      ['downloading', 'installing', 'checking'].includes(state.status)
    ) {
      return state;
    }
    publish({ status: 'downloading', percent: 0, error: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      fail(error);
    }
    return state;
  };

  const check = async () => {
    if (!app.isPackaged || state.downloaded || ['checking', 'downloading', 'installing'].includes(state.status)) {
      return state;
    }
    publish({ status: 'checking', error: null });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      fail(error);
    }
    return state;
  };

  autoUpdater.on('update-available', (info) => {
    publish({ status: 'available', version: info.version, error: null });
    if (shouldDownloadAutomatically) {
      void download();
    }
  });
  autoUpdater.on('update-not-available', () => publish({ status: 'current', version: null, error: null }));
  autoUpdater.on('download-progress', ({ percent }) =>
    publish({ status: 'downloading', percent: Math.max(0, Math.min(100, percent)) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    publish({ status: 'downloaded', version: info.version, percent: 100, downloaded: true, error: null });
  });
  autoUpdater.on('error', (error) => fail(error));

  ipcMain.handle(IPCChannel.GetUpdateState, () => state);
  ipcMain.handle(IPCChannel.CheckForUpdates, check);
  ipcMain.handle(IPCChannel.DownloadUpdate, download);
  ipcMain.handle(IPCChannel.ToggleAutoUpdate, (_event, enabled: boolean) => {
    shouldDownloadAutomatically = enabled;
  });
  ipcMain.handle(IPCChannel.InstallUpdate, async () => {
    if (!state.downloaded || state.status === 'installing') {
      return state;
    }
    publish({ status: 'installing', error: null });
    try {
      if (!(await prepareForInstall())) {
        publish({ status: 'downloaded', error: 'busy' });
        return state;
      }
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      fail(error, 'install');
    }
    return state;
  });

  if (app.isPackaged) {
    const initialCheck = setTimeout(() => void check(), 20_000);
    const periodicCheck = setInterval(() => void check(), 12 * 60 * 60 * 1000);
    initialCheck.unref();
    periodicCheck.unref();
    app.once('will-quit', () => {
      clearTimeout(initialCheck);
      clearInterval(periodicCheck);
    });
  }
}
