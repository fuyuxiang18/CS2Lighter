import { checkForNewBannedSteamAccounts } from './tasks/check-for-new-banned-steam-accounts';
import { startAutoImportDemoFolders, stopAutoImportDemoFolders } from './tasks/auto-import-demo-folders';

let scheduledTasksIntervalId: NodeJS.Timeout | null = null;

export async function startBackgroundTasks() {
  startAutoImportDemoFolders();
  // Prevents starting background tasks multiple times.
  // e.g. when the renderer window is closed and opened again.
  if (scheduledTasksIntervalId) {
    return;
  }

  const runScheduledTasks = async () => {
    await checkForNewBannedSteamAccounts();
  };

  await runScheduledTasks();
  const intervalInMs = 3_600_000; // 1 hour
  scheduledTasksIntervalId = setInterval(runScheduledTasks, intervalInMs);
}

export function stopBackgroundTasks() {
  stopAutoImportDemoFolders();
  if (scheduledTasksIntervalId) {
    clearInterval(scheduledTasksIntervalId);
  }
  scheduledTasksIntervalId = null;
}
