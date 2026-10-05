import path from 'node:path';

/** Compare Windows drive/UNC paths without requiring the recording to still exist. */
export function normalizeDemoPath(filePath: string): string {
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(filePath)) return path.win32.resolve(filePath).toLowerCase();
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
