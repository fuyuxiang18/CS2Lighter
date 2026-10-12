import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { DeathEvidenceKey, DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import { getDemoCacheGeneration, writeWithDemoCacheGeneration } from 'csdm/node/demo-cache/cache-generation';

const maximumBytes = 8 * 1024 ** 2;
const maximumDecodedBytes = 64 * 1024 ** 2;
const compress = promisify(gzip);
const decompress = promisify(gunzip);
type Entry = { revision: string; report: DeathEvidenceReport };
type File = { format: 'cs2lighter-death-evidence'; version: 1; checksum: string; entries: Entry[] };

export function validateDeathEvidenceKey(value: DeathEvidenceKey) {
  if (
    !value ||
    typeof value.checksum !== 'string' ||
    !/^[a-f0-9]{1,64}$/.test(value.checksum) ||
    typeof value.steamId !== 'string' ||
    !/^\d{17}$/.test(value.steamId) ||
    typeof value.deathId !== 'string' ||
    value.deathId.length === 0 ||
    value.deathId.length > 256
  )
    throw new Error('Invalid death evidence selection');
}

function destination(directory: string, checksum: string) {
  if (!/^[a-f0-9]{1,64}$/.test(checksum)) throw new Error('Invalid death evidence checksum');
  return path.join(directory, `${checksum}.json.gz`);
}

async function readFileCache(directory: string, checksum: string): Promise<File | undefined> {
  const file = destination(directory, checksum);
  try {
    if ((await stat(file)).size > maximumBytes) return undefined;
    const content = await readFile(file);
    if (content.byteLength > maximumBytes) return undefined;
    const decoded = await decompress(content, { maxOutputLength: maximumDecodedBytes });
    const parsed = JSON.parse(decoded.toString('utf8')) as File & { contentHash: string };
    if (!parsed || typeof parsed !== 'object') return undefined;
    const { contentHash, ...data } = parsed;
    if (
      data.format !== 'cs2lighter-death-evidence' ||
      data.version !== 1 ||
      data.checksum !== checksum ||
      !Array.isArray(data.entries) ||
      data.entries.length > 1000 ||
      contentHash !== createHash('sha256').update(JSON.stringify(data)).digest('hex')
    )
      return undefined;
    if (
      !data.entries.every(
        (entry) =>
          typeof entry?.revision === 'string' &&
          entry.report?.version === 1 &&
          entry.report.checksum === checksum &&
          typeof entry.report.generatedAt === 'string' &&
          (entry.report.matchRevision === undefined || /^[a-f0-9]{64}$/.test(entry.report.matchRevision)) &&
          typeof entry.report.deathId === 'string' &&
          /^\d{17}$/.test(entry.report.steamId) &&
          Number.isFinite(entry.report.tickrate) &&
          entry.report.tickrate > 0 &&
          entry.report.coverage !== null &&
          typeof entry.report.coverage === 'object' &&
          ['requestedTicks', 'decodedTicks', 'missingTicks', 'shots'].every((name) => {
            const value = entry.report.coverage[name as keyof DeathEvidenceReport['coverage']];
            return Number.isSafeInteger(value) && value >= 0;
          }) &&
          entry.report.coverage.requestedTicks <= 4096 &&
          entry.report.coverage.decodedTicks + entry.report.coverage.missingTicks ===
            entry.report.coverage.requestedTicks &&
          Array.isArray(entry.report.exposures) &&
          Array.isArray(entry.report.gunlines) &&
          Array.isArray(entry.report.spray?.points) &&
          Array.isArray(entry.report.spray?.findings),
      )
    )
      return undefined;
    return data;
  } catch (error) {
    if (
      ['ENOENT', 'Z_DATA_ERROR', 'Z_BUF_ERROR', 'ERR_BUFFER_TOO_LARGE'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      ) ||
      error instanceof SyntaxError
    )
      return undefined;
    throw error;
  }
}

export async function readDeathEvidenceCache(
  directory: string,
  key: DeathEvidenceKey,
  revision: string,
  offlineMatchRevision?: string,
) {
  validateDeathEvidenceKey(key);
  const data = await readFileCache(directory, key.checksum);
  const candidates = data?.entries.filter(
    (entry) =>
      entry.report.steamId === key.steamId &&
      entry.report.deathId === key.deathId &&
      (offlineMatchRevision === undefined
        ? entry.revision === revision
        : entry.report.matchRevision === offlineMatchRevision),
  );
  return candidates?.toSorted((a, b) => b.report.generatedAt.localeCompare(a.report.generatedAt))[0]?.report;
}

/** Called by the one serial evidence worker. It retains other deaths in the same demo file. */
export function writeDeathEvidenceCache(
  directory: string,
  revision: string,
  report: DeathEvidenceReport,
  signal: AbortSignal,
  generation = getDemoCacheGeneration(report.checksum),
) {
  return writeWithDemoCacheGeneration(report.checksum, generation, () =>
    saveDeathEvidenceCache(directory, revision, report, signal),
  );
}

async function saveDeathEvidenceCache(
  directory: string,
  revision: string,
  report: DeathEvidenceReport,
  signal: AbortSignal,
) {
  validateDeathEvidenceKey(report);
  signal.throwIfAborted();
  const previous = await readFileCache(directory, report.checksum);
  const entries = (previous?.entries ?? []).filter(
    (entry) => entry.report.deathId !== report.deathId || entry.report.steamId !== report.steamId,
  );
  entries.push({ revision, report });
  const data: File = { format: 'cs2lighter-death-evidence', version: 1, checksum: report.checksum, entries };
  const contentHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const content = JSON.stringify({ ...data, contentHash });
  if (entries.length > 1000 || Buffer.byteLength(content) > maximumDecodedBytes)
    throw new Error('Death evidence cache exceeds the per-demo size limit');
  const compressed = await compress(content);
  if (compressed.byteLength > maximumBytes) throw new Error('Death evidence cache exceeds the per-demo size limit');
  await mkdir(directory, { recursive: true });
  const file = destination(directory, report.checksum);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    signal.throwIfAborted();
    await writeFile(temporary, compressed, { flag: 'wx' });
    signal.throwIfAborted();
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
