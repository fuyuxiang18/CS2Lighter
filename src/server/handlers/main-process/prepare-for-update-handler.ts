import { hasWorkInProgress } from 'csdm/server/idle-monitor/idle-monitor';
import { stopBackgroundTasks } from 'csdm/server/start-background-tasks';
import { exitDaemon } from 'csdm/server/exit-daemon';
import { writeUpdateShutdownReceipt } from 'csdm/node/daemon/update-shutdown-receipt';
import { enterUpdateMaintenance } from 'csdm/server/update-maintenance';
import { getActiveRequestCount, server } from 'csdm/server/server';

export function prepareForUpdateHandler({ nonce }: { nonce: string }): Promise<boolean> {
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce)) {
    return Promise.resolve(false);
  }
  // Never interrupt parsing, inserts, exports, or another CLI client to replace binaries.
  if (
    hasWorkInProgress() ||
    getActiveRequestCount() > 0 ||
    server.getCliClientCount() > 0 ||
    server.isGameConnected()
  ) {
    return Promise.resolve(false);
  }

  enterUpdateMaintenance();
  stopBackgroundTasks();
  // The reply must reach Electron before exitDaemon closes the WebSocket server.
  setTimeout(() => void exitDaemon(0, () => writeUpdateShutdownReceipt(nonce)), 100);
  return Promise.resolve(true);
}
