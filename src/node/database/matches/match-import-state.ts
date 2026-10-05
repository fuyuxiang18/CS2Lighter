import path from 'node:path';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';

type MatchImportState = { checksum: string; demoPath: string; startedAt: string; status: 'inserting' | 'failed' };
const incomplete = new Map<string, MatchImportState>();
const active = new Set<string>();
let loaded: Promise<void> | undefined;

function directory() {
  return path.join(getAppFolderPath(), 'incomplete-match-imports');
}
function file(checksum: string) {
  if (!/^[a-f0-9]{1,64}$/.test(checksum)) throw new Error('Invalid match import checksum');
  return path.join(directory(), `${checksum}.json`);
}
async function load() {
  const names = await readdir(directory()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of names) {
    if (!/^[a-f0-9]{1,64}\.json$/.test(name)) continue;
    const checksum = name.slice(0, -5);
    const value = JSON.parse(await readFile(file(checksum), 'utf8')) as MatchImportState;
    if (value.checksum !== checksum || typeof value.demoPath !== 'string')
      throw new Error('Unreadable incomplete match import marker');
    incomplete.set(checksum, value);
  }
}
export async function getIncompleteMatchImports(): Promise<ReadonlyMap<string, MatchImportState>> {
  loaded ??= load();
  await loaded;
  return incomplete;
}
async function save(value: MatchImportState) {
  await mkdir(directory(), { recursive: true });
  const target = file(value.checksum),
    temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
export class MatchImportIncompleteError extends Error {
  constructor(
    public readonly checksum: string,
    public readonly demoPath: string,
  ) {
    super(
      'This match is still being saved or its previous import was interrupted. Retry the import explicitly when it is idle.',
    );
  }
}
export async function assertMatchImportComplete(checksum: string) {
  const value = (await getIncompleteMatchImports()).get(checksum);
  if (value) throw new MatchImportIncompleteError(checksum, value.demoPath);
}
export function isMatchImportActive(checksum: string) {
  return active.has(checksum);
}
export async function beginMatchImport(checksum: string, demoPath: string) {
  await getIncompleteMatchImports();
  if (active.has(checksum)) throw new Error('This match is already being saved');
  active.add(checksum);
  const value: MatchImportState = { checksum, demoPath, startedAt: new Date().toISOString(), status: 'inserting' };
  incomplete.set(checksum, value);
  try {
    await save(value);
  } catch (error) {
    active.delete(checksum);
    throw error;
  }
}
export async function failMatchImport(checksum: string) {
  const value = incomplete.get(checksum);
  try {
    if (value) {
      value.status = 'failed';
      await save(value);
    }
  } finally {
    active.delete(checksum);
  }
}
export async function completeMatchImport(checksum: string) {
  try {
    await rm(file(checksum), { force: true });
    incomplete.delete(checksum);
  } finally {
    active.delete(checksum);
  }
}
export async function clearIncompleteMatchImports(checksums: string[]) {
  await getIncompleteMatchImports();
  if (checksums.some(isMatchImportActive)) throw new Error('A match is still being saved');
  for (const checksum of checksums) await completeMatchImport(checksum);
}
