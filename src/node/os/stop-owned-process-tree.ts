import { execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { isWindows } from './is-windows';

const execute = promisify(execFile);

/** Only accepts the child handle created by this request, never an image name. */
export async function stopOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  } else {
    child.kill();
  }
}
