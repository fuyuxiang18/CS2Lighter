import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { DemoSource, GameMode } from 'csdm/common/types/counter-strike';

const DEATH_FACTS_VERSION = 1;
const DEATH_RULES_VERSION = 1;
const MAX_CACHE_BYTES = 32 * 1024 ** 2;
const memory = new Map<string, { stamp: string; bytes: number; revision: string; records: DeathReviewRecord[] }>();
let memoryBytes = 0;

function forget(file: string) {
  memoryBytes -= memory.get(file)?.bytes ?? 0;
  memory.delete(file);
}

export type DeathMatchDescriptor = {
  checksum: string;
  name: string;
  analyzeDate: string;
  mapName: string;
  date: string;
  source: DemoSource;
  tickrate: number;
  networkProtocol: number;
  gameMode: GameMode;
  shotCount: number;
};

type DeathReviewCache = {
  format: 'cs2lighter-death-review';
  factsVersion: number;
  rulesVersion: number;
  checksum: string;
  analyzeDate: string;
  revision: string;
  generatedAt: string;
  records: DeathReviewRecord[];
  contentHash?: string;
};

export function deathMatchRevision(match: DeathMatchDescriptor) {
  return createHash('sha256')
    .update(JSON.stringify([DEATH_FACTS_VERSION, DEATH_RULES_VERSION, match]))
    .digest('hex');
}

function cachePath(directory: string, checksum: string) {
  if (!/^[a-f0-9]{1,64}$/.test(checksum)) throw new Error('Invalid death review checksum');
  return path.join(directory, `${checksum}.json`);
}

function validRecord(value: unknown, checksum: string): value is DeathReviewRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<DeathReviewRecord>;
  return (
    record.checksum === checksum &&
    typeof record.id === 'string' &&
    typeof record.steamId === 'string' &&
    /^\d{17}$/.test(record.steamId) &&
    Number.isFinite(record.eventTick) &&
    Number.isFinite(record.roundNumber) &&
    typeof record.date === 'string' &&
    Array.isArray(record.findings) &&
    record.findings.every((finding) => typeof finding?.code === 'string' && Array.isArray(finding.measures)) &&
    Array.isArray(record.evaluatedRules) &&
    Array.isArray(record.missingSignals) &&
    Array.isArray(record.timeline)
  );
}

export async function readDeathReviewCache(
  directory: string,
  match: DeathMatchDescriptor,
): Promise<DeathReviewRecord[] | undefined> {
  const file = cachePath(directory, match.checksum);
  try {
    const metadata = await stat(file);
    const stamp = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    const revision = deathMatchRevision(match);
    const cached = memory.get(file);
    if (cached?.stamp === stamp && cached.revision === revision) {
      memory.delete(file);
      memory.set(file, cached);
      return cached.records;
    }
    forget(file);
    if (metadata.size > MAX_CACHE_BYTES) return undefined;
    const content = await readFile(file);
    if (content.byteLength > MAX_CACHE_BYTES) return undefined;
    const value: unknown = JSON.parse(content.toString('utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const cache = value as Partial<DeathReviewCache>;
    if (
      cache.format !== 'cs2lighter-death-review' ||
      cache.factsVersion !== DEATH_FACTS_VERSION ||
      cache.rulesVersion !== DEATH_RULES_VERSION ||
      cache.checksum !== match.checksum ||
      cache.analyzeDate !== match.analyzeDate ||
      cache.revision !== revision ||
      !Array.isArray(cache.records) ||
      !cache.records.every((record) => validRecord(record, match.checksum))
    )
      return undefined;
    const { contentHash, ...data } = cache;
    if (contentHash !== createHash('sha256').update(JSON.stringify(data)).digest('hex')) return undefined;
    while (memory.size > 0 && (memoryBytes + metadata.size > MAX_CACHE_BYTES || memory.size >= 64)) {
      forget(memory.keys().next().value!);
    }
    forget(file);
    memory.set(file, { stamp, bytes: metadata.size, revision, records: cache.records });
    memoryBytes += metadata.size;
    return cache.records;
  } catch (error) {
    forget(file);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export async function writeDeathReviewCache(
  directory: string,
  match: DeathMatchDescriptor,
  records: DeathReviewRecord[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const data: DeathReviewCache = {
    format: 'cs2lighter-death-review',
    factsVersion: DEATH_FACTS_VERSION,
    rulesVersion: DEATH_RULES_VERSION,
    checksum: match.checksum,
    analyzeDate: match.analyzeDate,
    revision: deathMatchRevision(match),
    generatedAt: new Date().toISOString(),
    records,
  };
  const contentHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const content = JSON.stringify({ ...data, contentHash });
  if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new Error('Death review cache exceeds the size limit');
  await mkdir(directory, { recursive: true });
  const destination = cachePath(directory, match.checksum);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    signal.throwIfAborted();
    await rename(temporary, destination);
    forget(destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
