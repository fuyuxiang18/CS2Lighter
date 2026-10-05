import path from 'node:path';
import fs from 'fs-extra';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { normalizeDemoPath } from 'csdm/common/normalize-demo-path';
import { getDemoFileFingerprint } from './tasks/demo-file-readiness';

type State = { paused: boolean; suppressed: Record<string, string>; suppressedChecksums: Record<string, true> };
let state: State = { paused: false, suppressed: {}, suppressedChecksums: {} };
let loaded: Promise<void> | undefined;
let writing: Promise<void> = Promise.resolve();
function file() {
  return path.join(getAppFolderPath(), 'import-queue-control.json');
}

export async function getImportQueueControl() {
  loaded ??= fs
    .readJson(file())
    .then((saved: unknown) => {
      if (saved && typeof saved === 'object' && 'paused' in saved && 'suppressed' in saved) {
        state.paused = saved.paused === true;
        if (saved.suppressed && typeof saved.suppressed === 'object')
          state.suppressed = Object.fromEntries(
            Object.entries(saved.suppressed).filter(([, value]) => typeof value === 'string'),
          );
        if (
          'suppressedChecksums' in saved &&
          saved.suppressedChecksums &&
          typeof saved.suppressedChecksums === 'object'
        )
          state.suppressedChecksums = Object.fromEntries(
            Object.entries(saved.suppressedChecksums).filter(
              ([checksum, value]) => /^[a-f0-9]{1,64}$/.test(checksum) && value === true,
            ),
          );
      }
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') logger.error('Could not read import queue controls', error);
    });
  await loaded;
  return state;
}

function save() {
  const value = JSON.stringify(state);
  writing = writing
    .catch(() => {})
    .then(async () => {
      const target = file();
      await fs.outputFile(`${target}.tmp`, value);
      await fs.move(`${target}.tmp`, target, { overwrite: true });
    });
  return writing;
}

export async function setImportQueuePaused(paused: boolean) {
  await getImportQueueControl();
  state.paused = paused;
  await save();
}

export async function suppressDemoImport(filePath: string, checksum?: string) {
  await getImportQueueControl();
  if (checksum !== undefined) {
    if (!/^[a-f0-9]{1,64}$/.test(checksum)) throw new Error('Invalid demo checksum');
    // A queue item is one recording, even when several watched folders contain copies.
    // Do not also retain a path suppression: explicit selection of any copy restores all copies.
    state.suppressedChecksums[checksum] = true;
    delete state.suppressed[normalizeDemoPath(filePath)];
    await save();
    return;
  }
  const fingerprint = await fs
    .stat(filePath)
    .then(getDemoFileFingerprint)
    .catch(() => 'missing');
  state.suppressed[normalizeDemoPath(filePath)] = fingerprint;
  await save();
}

export async function allowDemoImport(filePath: string, checksum?: string) {
  await getImportQueueControl();
  const key = normalizeDemoPath(filePath);
  if (key in state.suppressed || (checksum !== undefined && checksum in state.suppressedChecksums)) {
    delete state.suppressed[key];
    if (checksum !== undefined) delete state.suppressedChecksums[checksum];
    await save();
  }
}
