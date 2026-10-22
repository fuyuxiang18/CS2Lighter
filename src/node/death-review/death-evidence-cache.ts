import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { gzip, gunzip, gzipSync, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import type { DeathEvidenceKey, DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import type { DeathRiskInput, DeathRiskReport } from 'csdm/common/types/death-risk';
import { getDemoCacheGeneration, writeWithDemoCacheGeneration } from 'csdm/node/demo-cache/cache-generation';
import {
  DEATH_ENVIRONMENT_REVISION,
  DEATH_RISK_REVISION,
  DEATH_RISK_RULES,
} from 'csdm/common/death-review/death-risk-rules';
import { buildDeathRiskReport } from './death-risk-engine';
import { isDeathRiskInput, isDeathRiskReport } from './death-risk-cache-validation';

const maximumBytes = 8 * 1024 ** 2;
const maximumDecodedBytes = 64 * 1024 ** 2;
const compress = promisify(gzip);
const decompress = promisify(gunzip);
type StoredReport = Omit<DeathEvidenceReport, 'riskFacts'> & { riskFacts?: DeathRiskInput | string };
type Entry = { revision: string; report: StoredReport };
type File = { format: 'cs2lighter-death-evidence'; version: 1; checksum: string; entries: Entry[] };
const memory = new Map<string, { stamp: string; bytes: number; data: File }>();
let memoryBytes = 0;
const maximumMemoryBytes = 32 * 1024 ** 2;
const currentReports = new WeakMap<StoredReport, DeathEvidenceReport>();

function validAnimation(value: unknown, maximumFrames: number) {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const count = (name: string, max: number) =>
    typeof data[name] === 'number' && Number.isSafeInteger(data[name]) && data[name] >= 0 && data[name] <= max;
  const names = (name: string, max: number) =>
    Array.isArray(data[name]) &&
    data[name].length <= max &&
    data[name].every((item: unknown) => typeof item === 'string' && item.length <= 256);
  return (
    count('framesWithRecipe', maximumFrames) &&
    count('decodedTopologyFrames', data.framesWithRecipe as number) &&
    count('graphResourceCount', 16384) &&
    count('boneCount', 16384) &&
    count('maskCount', 16384) &&
    names('taskTypes', 255) &&
    names('blockingTasks', 255) &&
    names('reasons', 32)
  );
}

function validMechanics(value: unknown, startTick: number, endTick: number) {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const reasons = (items: unknown) =>
    Array.isArray(items) && items.length <= 32 && items.every((item) => typeof item === 'string' && item.length <= 128);
  const finiteOrNull = (item: unknown) =>
    item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0);
  return (
    reasons(data.reasons) &&
    Array.isArray(data.measurements) &&
    data.measurements.length <= 4096 &&
    data.measurements.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.shotId === 'string' &&
        item.shotId.length <= 256 &&
        typeof item.weaponName === 'string' &&
        item.weaponName.length <= 128 &&
        Number.isSafeInteger(item.tick) &&
        item.tick >= startTick &&
        item.tick <= endTick &&
        ['inaccuracy', 'spread', 'stationaryInaccuracy', 'speed', 'firstServerTick', 'lastServerTick'].every((key) =>
          finiteOrNull(item[key]),
        ) &&
        (item.component === null || ['movement', 'landing', 'recovery'].includes(item.component)) &&
        (item.measurementSource === undefined ||
          ['fire-bullets-extra', 'bullet-damage'].includes(item.measurementSource)) &&
        ['movementInaccuracy', 'airborneInaccuracy'].every(
          (key) =>
            item[key] === undefined || (typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0),
        ) &&
        reasons(item.reasons),
    )
  );
}

/** Retire R4 and any old conclusions that depended on unverified opaque surfaces. */
function retireUnsupportedRisk(report: unknown, environmentCurrent: boolean): DeathRiskReport | undefined {
  if (
    !isDeathRiskReport(report) ||
    !['2026-10-22.1', '2026-10-22.2', DEATH_RISK_REVISION].includes(report.ruleRevision)
  )
    return undefined;
  const active = new Set(DEATH_RISK_RULES.map(({ id }) => id));
  const reusable = (id: string) => environmentCurrent || ['r1', 'r2', 'r3', 'r5'].includes(id);
  const findings = report.findings
    .filter((item) => active.has(item.ruleId) && reusable(item.ruleId))
    .map((item) => ({
      ...item,
      relatedRuleIds: item.relatedRuleIds.filter((id) => active.has(id) && reusable(id)),
    }));
  const ids = new Set(findings.map(({ id }) => id));
  const selectedFindingIds = report.selectedFindingIds.filter((id) => ids.has(id));
  // Preserve the previous independent selection. If its only item was retired, show one remaining risk.
  if (selectedFindingIds.length === 0 && findings.length > 0)
    selectedFindingIds.push(findings.toSorted((a, b) => b.priority - a.priority)[0].id);
  const evaluations = report.evaluations
    .filter(({ ruleId }) => active.has(ruleId))
    .map((item) => {
      if (
        environmentCurrent ||
        ['r1', 'r2', 'r3'].includes(item.ruleId) ||
        item.status === 'not-applicable' ||
        (item.ruleId === 'r5' && item.status === 'matched')
      )
        return item;
      return { ...item, status: 'unavailable' as const, reasons: ['surface-unverified'], findingIds: [] };
    });
  const unavailable = evaluations.filter(({ status }) => status === 'unavailable').length;
  return {
    ...report,
    ruleRevision: DEATH_RISK_REVISION,
    findings,
    selectedFindingIds,
    evaluations,
    status: unavailable === evaluations.length ? 'unavailable' : unavailable > 0 ? 'partial' : 'evaluated',
  };
}

function currentEnvironmentFacts(facts: DeathRiskInput): DeathRiskInput {
  if (facts.environmentRevision === DEATH_ENVIRONMENT_REVISION) return facts;
  return {
    ...facts,
    environmentRevision: DEATH_ENVIRONMENT_REVISION,
    frames: facts.frames.map((frame) => ({
      ...frame,
      lines: frame.lines.map((line) => ({
        ...line,
        ...(line.status === 'blocked' ? { status: 'unknown' as const, reason: 'surface-unverified' } : {}),
        ...(line.previousObserverPosition?.status === 'blocked'
          ? {
              previousObserverPosition: { ...line.previousObserverPosition, status: 'unknown' as const },
            }
          : {}),
      })),
    })),
    cover: [],
    support: [],
    supportTransitions: undefined,
    postKillCoverDepartures: undefined,
  };
}

function currentReport(report: StoredReport): DeathEvidenceReport {
  const previous = currentReports.get(report);
  if (previous) return previous;
  const result = { ...report, riskFacts: undefined } as DeathEvidenceReport;
  delete result.riskFacts;
  if (!validMechanics(result.mechanics, result.startTick, result.deathTick)) delete result.mechanics;
  if (!validAnimation(result.animation, result.coverage.decodedTicks)) delete result.animation;
  const environmentCurrent = report.environmentRevision === DEATH_ENVIRONMENT_REVISION;
  if (!environmentCurrent && result.gunlines.some((line) => line.status === 'blocked')) {
    result.gunlines = result.gunlines.map((line) =>
      line.status === 'blocked' ? { ...line, status: 'unknown', reason: 'surface-unverified' } : line,
    );
    if (result.gunlineAnalysis)
      result.gunlineAnalysis = {
        ...result.gunlineAnalysis,
        status: result.gunlines.some((line) => line.status === 'clear') ? 'partial' : 'unavailable',
        reasons: [...new Set([...result.gunlineAnalysis.reasons, 'surface-unverified'])],
      };
  }
  const migrated = retireUnsupportedRisk(result.risk, environmentCurrent);
  if (migrated) result.risk = migrated;
  else delete result.risk;
  if (!result.risk) {
    try {
      const facts: unknown =
        typeof report.riskFacts === 'string'
          ? JSON.parse(
              gunzipSync(Buffer.from(report.riskFacts, 'base64'), { maxOutputLength: 16 * 1024 ** 2 }).toString('utf8'),
            )
          : report.riskFacts;
      if (
        isDeathRiskInput(facts) &&
        facts.subjectId === result.steamId &&
        facts.startTick === result.startTick &&
        facts.deathTick === result.deathTick &&
        facts.tickrate === result.tickrate
      )
        result.risk = buildDeathRiskReport(currentEnvironmentFacts(facts));
    } catch {
      // Optional facts may be unavailable; the original trajectory remains readable.
    }
  }
  currentReports.set(report, result);
  return result;
}

function forget(file: string) {
  memoryBytes -= memory.get(file)?.bytes ?? 0;
  memory.delete(file);
}

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
    const metadata = await stat(file);
    if (metadata.size > maximumBytes) {
      forget(file);
      return undefined;
    }
    const stamp = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    const cached = memory.get(file);
    if (cached?.stamp === stamp) {
      memory.delete(file);
      memory.set(file, cached);
      return cached.data;
    }
    forget(file);
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
    if (decoded.byteLength <= maximumMemoryBytes) {
      while (memory.size > 0 && (memory.size >= 32 || memoryBytes + decoded.byteLength > maximumMemoryBytes)) {
        forget(memory.keys().next().value!);
      }
      memory.set(file, { stamp, bytes: decoded.byteLength, data });
      memoryBytes += decoded.byteLength;
    }
    return data;
  } catch (error) {
    forget(file);
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

/** Reads one per-demo file for list summaries; it never starts a demo extraction. */
export async function readDeathRiskReports(directory: string, checksum: string, matchRevision: string) {
  const data = await readFileCache(directory, checksum);
  const reports = new Map<string, { generatedAt: string; report: DeathRiskReport }>();
  for (const entry of data?.entries ?? []) {
    const report = currentReport(entry.report);
    if (report.matchRevision !== matchRevision || !report.risk) continue;
    const key = `${report.steamId}:${report.deathId}`;
    if ((reports.get(key)?.generatedAt ?? '') < report.generatedAt) {
      reports.set(key, { generatedAt: report.generatedAt, report: report.risk });
    }
  }
  return new Map(Array.from(reports, ([key, value]) => [key, value.report]));
}

export async function readDeathEvidenceCache(
  directory: string,
  key: DeathEvidenceKey,
  revision: string,
  savedMatchRevision?: string,
) {
  validateDeathEvidenceKey(key);
  if (savedMatchRevision !== undefined && !/^[a-f0-9]{64}$/.test(savedMatchRevision)) return undefined;
  const data = await readFileCache(directory, key.checksum);
  const candidates = data?.entries.filter(
    (entry) =>
      entry.report.steamId === key.steamId &&
      entry.report.deathId === key.deathId &&
      (savedMatchRevision === undefined
        ? entry.revision === revision
        : entry.report.matchRevision === savedMatchRevision ||
          (entry.report.matchRevision === undefined && entry.revision === revision)),
  );
  const entry = candidates?.toSorted((a, b) => b.report.generatedAt.localeCompare(a.report.generatedAt))[0];
  if (!entry) return undefined;
  const report = currentReport(entry.report);
  // Saved facts describe the original recording/resources. Reading them does
  // not certify newly installed map assets or trigger another demo extraction.
  // Copy the view-only flag; never contaminate the normalized cache object.
  return entry.revision === revision ? report : { ...report, loadedFromSavedEvidence: true as const };
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
  // Retain reusable facts losslessly without multiplying the per-demo JSON size or sending them to the UI.
  const stored: StoredReport = { ...report };
  if (report.riskFacts) {
    const facts = JSON.stringify(report.riskFacts);
    if (Buffer.byteLength(facts) > 16 * 1024 ** 2) throw new Error('Death risk facts exceed the per-death size limit');
    stored.riskFacts = gzipSync(facts).toString('base64');
  }
  entries.push({ revision, report: stored });
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
    forget(file);
  } finally {
    await rm(temporary, { force: true });
  }
}
