import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type GameProcess = { ProcessId: number; CommandLine: string | null };

export function findReviewGameProcesses(processes: GameProcess[], demoPath: string): number[] {
  const normalized = demoPath.replaceAll('\\', '/').toLowerCase();
  return processes
    .filter(({ CommandLine }) => {
      const command = CommandLine?.replaceAll('\\', '/').toLowerCase();
      const argument = command?.match(/(?:^|\s)\+playdemo\s+(?:"([^"]+)"|(\S+))/);
      return (argument?.[1] ?? argument?.[2]) === normalized;
    })
    .map(({ ProcessId }) => ProcessId);
}

/** Match the unique staged demo path; never terminate games or encoders by image name. */
export async function stopReviewGameProcesses(demoPath: string): Promise<void> {
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '@(Get-CimInstance Win32_Process -Filter "Name = \'cs2.exe\'" | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress',
    ],
    { windowsHide: true },
  );
  const parsed: GameProcess | GameProcess[] = stdout.trim() ? JSON.parse(stdout) : [];
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  for (const id of findReviewGameProcesses(processes, demoPath)) {
    await execute('taskkill', ['/PID', String(id), '/T', '/F'], { windowsHide: true }).catch(() => {});
  }
}
