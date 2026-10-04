import path from 'node:path';
import { homedir } from 'node:os';

export function resolveAppFolderPath(isDev: boolean) {
  const customFolder = process.env.CS2_PARSER_DATA_DIR;
  if (customFolder && path.isAbsolute(customFolder)) {
    return customFolder;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
    return path.join(localAppData, isDev ? 'CS2Parser-dev' : 'CS2Parser');
  }

  if (process.platform !== 'linux') {
    return path.join(homedir(), isDev ? '.cs2-parser-dev' : '.cs2-parser');
  }

  const folderName = isDev ? 'cs2-parser-dev' : 'cs2-parser';
  // https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html#variables
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (typeof xdgConfigHome === 'string' && xdgConfigHome !== '') {
    return path.join(xdgConfigHome, folderName);
  }

  return path.join(homedir(), '.config', folderName);
}
