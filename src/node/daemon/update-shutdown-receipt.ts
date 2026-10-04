import path from 'node:path';
import fs from 'fs-extra';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';

function getReceiptPath() {
  return path.join(getAppFolderPath(), 'update-shutdown.json');
}

export function writeUpdateShutdownReceipt(nonce: string) {
  return fs.writeJson(getReceiptPath(), { nonce, pid: process.pid });
}

export async function hasUpdateShutdownReceipt(nonce: string, pid: number): Promise<boolean> {
  try {
    const receipt: unknown = await fs.readJson(getReceiptPath());
    return (
      typeof receipt === 'object' &&
      receipt !== null &&
      'nonce' in receipt &&
      'pid' in receipt &&
      receipt.nonce === nonce &&
      receipt.pid === pid
    );
  } catch {
    return false;
  }
}
