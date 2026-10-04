import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { hasUpdateShutdownReceipt } from 'csdm/node/daemon/update-shutdown-receipt';
import { readDaemonInfoFile } from 'csdm/node/daemon/daemon-info-file';
import { isProcessAlive } from 'csdm/node/os/is-process-alive';
import { MainClientMessageName } from 'csdm/server/messages/main-client-message-name';
import type { WebSocketClient } from './web-socket/web-socket-client';

export async function prepareUpdateInstall(client: WebSocketClient): Promise<boolean> {
  const daemon = await readDaemonInfoFile();
  if (!daemon || !client.isConnected) {
    throw new Error('The database service is unavailable. Restart the application before updating.');
  }
  const nonce = randomUUID();
  const accepted = await Promise.race([
    client.send({ name: MainClientMessageName.PrepareForUpdate, payload: { nonce } }),
    setTimeout(10_000).then(() => false),
  ]);
  if (!accepted) {
    return false;
  }
  client.disconnect();
  const deadline = Date.now() + 65_000;
  while (isProcessAlive(daemon.pid)) {
    if (Date.now() > deadline) {
      throw new Error('The database service did not stop in time. The update was not installed.');
    }
    await setTimeout(200);
  }
  if (!(await hasUpdateShutdownReceipt(nonce, daemon.pid))) {
    throw new Error('Database shutdown was not confirmed. The update was not installed.');
  }
  return true;
}
