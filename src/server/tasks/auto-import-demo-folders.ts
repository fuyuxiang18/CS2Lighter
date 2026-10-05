import path from 'node:path';
import fs from 'fs-extra';
import { getSettings } from 'csdm/node/settings/get-settings';
import { glob } from 'csdm/node/filesystem/glob';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { getDemoFromFilePath } from 'csdm/node/demo/get-demo-from-file-path';
import { hasCompleteSource2Demo } from 'csdm/node/demo/has-complete-source2-demo';
import { fetchMatchChecksums } from 'csdm/node/database/matches/fetch-match-checksums';
import { getIncompleteMatchImports, isMatchImportActive } from 'csdm/node/database/matches/match-import-state';
import { isDatabaseConnected } from 'csdm/node/database/database';
import { analysesListener } from 'csdm/server/analyses-listener';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';
import { importProgress } from 'csdm/server/import-progress';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { getDemoCacheFailures, retryFailedDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { normalizeDemoPath } from 'csdm/common/normalize-demo-path';
import { getImportQueueControl, allowDemoImport } from 'csdm/server/import-queue-control';
import {
  DemoFileReadiness,
  getDemoFileFingerprint,
  shouldSkipDemoImport,
  type DemoImportRecord,
} from './demo-file-readiness';

const readiness = new DemoFileReadiness();
const records = new Map<string, DemoImportRecord>();
const pending = new Map<string, { filePath: string; fingerprint: string }>();
const scanIntervalMs = 5000;
const stableForMs = 10000;
const maximumBlockingWaitMs = 20000;
const reportedFingerprints = new Map<string, string>();
const waitingSince = new Map<string, number>();
const deferredFiles = new Set<string>();
let foldersSignature = '';
let initialDiscoveryPending = false;
let interval: NodeJS.Timeout | undefined;
let scanning = false;
let generation = 0;
let recordsLoaded = false;
let stopCompletionListener: (() => void) | undefined;
let writingState: Promise<void> = Promise.resolve();

function getStatePath() {
  return path.join(getAppFolderPath(), 'folder-import-state.json');
}

async function loadRecords() {
  if (recordsLoaded) {
    return;
  }
  recordsLoaded = true;
  try {
    const saved: unknown = await fs.readJson(getStatePath());
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
      return;
    }
    for (const [filePath, value] of Object.entries(saved)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'fingerprint' in value &&
        typeof value.fingerprint === 'string' &&
        'failed' in value &&
        typeof value.failed === 'boolean'
      ) {
        records.set(normalizeDemoPath(filePath), {
          fingerprint: value.fingerprint,
          failed: value.failed,
          checksum: 'checksum' in value && typeof value.checksum === 'string' ? value.checksum : undefined,
          reason: 'reason' in value && typeof value.reason === 'string' ? value.reason : undefined,
          message: 'message' in value && typeof value.message === 'string' ? value.message : undefined,
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Unable to restore folder import state; files will be checked again');
      logger.error(error);
    }
  }
}

function saveRecords() {
  const snapshot = Object.fromEntries(records);
  writingState = writingState
    .then(async () => {
      const statePath = getStatePath();
      const temporaryPath = `${statePath}.tmp`;
      await fs.outputJson(temporaryPath, snapshot);
      await fs.move(temporaryPath, statePath, { overwrite: true });
    })
    .catch((error: unknown) => {
      logger.error('Unable to save folder import state');
      logger.error(error);
    });
}

async function scanFolders() {
  if (scanning || interval === undefined || !isDatabaseConnected() || isUpdateMaintenance()) {
    return;
  }
  scanning = true;
  const scanGeneration = generation;
  let changed = false;
  let progressDiscoveryStarted = false;
  function beginProgressDiscovery() {
    if (!progressDiscoveryStarted) {
      importProgress.beginDiscovery();
      progressDiscoveryStarted = true;
    }
  }
  try {
    const settings = await getSettings();
    const controls = await getImportQueueControl();
    if (controls.paused) return;
    if (settings.analyze.autoAnalyzeFolders === false) {
      readiness.clear();
      foldersSignature = '';
      reportedFingerprints.clear();
      waitingSince.clear();
      deferredFiles.clear();
      importProgress.settleWaiting('disabled');
      return;
    }
    const signature = JSON.stringify(settings.folders);
    if (signature !== foldersSignature) {
      foldersSignature = signature;
      reportedFingerprints.clear();
      waitingSince.clear();
      deferredFiles.clear();
      importProgress.settleWaiting('folder-removed');
      beginProgressDiscovery();
    }
    await loadRecords();
    const filePaths = new Set<string>();
    for (const folder of settings.folders) {
      try {
        const files = await glob(folder.includeSubFolders ? '**/*.dem' : '*.dem', {
          cwd: folder.path,
          absolute: true,
          caseSensitiveMatch: false,
          followSymbolicLinks: false,
        });
        for (const filePath of files) {
          filePaths.add(normalizeDemoPath(filePath));
        }
      } catch (error) {
        logger.warn(`Unable to scan demo folder ${folder.path}`);
        logger.error(error);
      }
    }
    readiness.removeMissingFiles(filePaths);
    for (const filePath of waitingSince.keys()) {
      if (!filePaths.has(filePath)) {
        waitingSince.delete(filePath);
        deferredFiles.delete(filePath);
        importProgress.update(filePath, 'skipped', { reason: 'removed' });
      }
    }
    if (filePaths.size === 0) {
      return;
    }
    const incompleteImports = await getIncompleteMatchImports();
    const knownChecksums = new Set(
      (await fetchMatchChecksums()).filter((checksum) => !incompleteImports.has(checksum)),
    );
    const queuedThisScan = new Set<string>();
    for (const filePath of filePaths) {
      if (scanGeneration !== generation || controls.paused || !isDatabaseConnected() || isUpdateMaintenance()) {
        break;
      }
      let fingerprint: string | undefined;
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          continue;
        }
        fingerprint = getDemoFileFingerprint(stats);
        if (controls.suppressed[filePath] === fingerprint) {
          importProgress.update(filePath, 'skipped', { reason: 'cancelled' });
          continue;
        }
        const record = records.get(filePath);
        if (record?.fingerprint === fingerprint && record.checksum && controls.suppressedChecksums[record.checksum]) {
          importProgress.update(filePath, 'skipped', { reason: 'cancelled' });
          continue;
        }
        const interrupted = [...incompleteImports.values()].find(
          (entry) => normalizeDemoPath(entry.demoPath) === filePath && !isMatchImportActive(entry.checksum),
        );
        if (interrupted) {
          importProgress.update(filePath, 'failed', {
            reason: 'insertion',
            message: 'The previous save was interrupted. Retry this import explicitly to replace incomplete data.',
          });
          continue;
        }
        // Cache retries never need the original recording, and a successful backfill repairs an earlier cache failure.
        if (
          record?.reason === 'cache' &&
          record.checksum &&
          knownChecksums.has(record.checksum) &&
          !getDemoCacheFailures().has(filePath)
        ) {
          record.failed = false;
          record.reason = undefined;
          record.message = undefined;
          changed = true;
        }
        if (shouldSkipDemoImport(record, fingerprint, knownChecksums)) {
          if (reportedFingerprints.get(filePath) !== fingerprint) {
            beginProgressDiscovery();
            const cacheFailure = getDemoCacheFailures().get(filePath);
            importProgress.update(filePath, record?.failed || cacheFailure ? 'failed' : 'skipped', {
              reason: cacheFailure ? 'cache' : record?.failed ? (record.reason ?? 'analysis') : 'already-imported',
              message: cacheFailure?.message ?? record?.message,
            });
            reportedFingerprints.set(filePath, fingerprint);
          }
          continue;
        }
        if (analysesListener.getAnalyses().some((analysis) => normalizeDemoPath(analysis.demoPath) === filePath)) {
          continue;
        }
        const now = Date.now();
        if (!readiness.isReady(filePath, fingerprint, now, stableForMs)) {
          const started = waitingSince.get(filePath) ?? now;
          waitingSince.set(filePath, started);
          if (!deferredFiles.has(filePath)) {
            if (reportedFingerprints.get(filePath) !== fingerprint) {
              beginProgressDiscovery();
              importProgress.update(filePath, 'waiting');
              reportedFingerprints.set(filePath, fingerprint);
            }
            if (now - started >= maximumBlockingWaitMs) {
              deferredFiles.add(filePath);
              importProgress.update(filePath, 'skipped', {
                reason: 'unstable',
                message: 'File is still changing; it will be checked again automatically.',
              });
            }
          }
          continue;
        }
        waitingSince.delete(filePath);
        deferredFiles.delete(filePath);
        beginProgressDiscovery();
        importProgress.update(filePath, 'pending');
        reportedFingerprints.set(filePath, fingerprint);
        if (!(await hasCompleteSource2Demo(filePath))) {
          const failure = { reason: 'incomplete', message: 'Recording is incomplete or is not a supported CS2 demo.' };
          records.set(filePath, { fingerprint, failed: true, ...failure });
          importProgress.update(filePath, 'failed', failure);
          changed = true;
          logger.log(`Waiting for a complete CS2 recording before importing ${filePath}`);
          continue;
        }
        const demo = await getDemoFromFilePath(filePath);
        // The file may have changed while its framing/header was read. Observe it again before enqueueing.
        if (getDemoFileFingerprint(await fs.stat(filePath)) !== fingerprint || scanGeneration !== generation) {
          importProgress.update(filePath, 'skipped', { reason: 'unstable' });
          continue;
        }
        if (controls.suppressedChecksums[demo.checksum]) {
          records.set(filePath, { fingerprint, checksum: demo.checksum, failed: false, reason: 'cancelled' });
          changed = true;
          importProgress.update(filePath, 'skipped', { reason: 'cancelled' });
          continue;
        }
        if (incompleteImports.has(demo.checksum) && !isMatchImportActive(demo.checksum)) {
          importProgress.update(filePath, 'failed', {
            reason: 'insertion',
            message: 'The previous save was interrupted. Retry this import explicitly to replace incomplete data.',
          });
          continue;
        }
        if (knownChecksums.has(demo.checksum)) {
          records.set(filePath, { fingerprint, checksum: demo.checksum, failed: false });
          changed = true;
          const cacheFailure = getDemoCacheFailures().get(filePath);
          importProgress.update(filePath, cacheFailure ? 'failed' : 'skipped', {
            reason: cacheFailure ? 'cache' : 'already-imported',
            message: cacheFailure?.message,
          });
          continue;
        }
        const queuedAnalysis = analysesListener
          .getAnalyses()
          .find((analysis) => analysis.demoChecksum === demo.checksum);
        if (queuedThisScan.has(demo.checksum) || queuedAnalysis) {
          records.set(filePath, { fingerprint, checksum: demo.checksum, failed: false });
          changed = true;
          // A manual request may have queued this same file while its framing was being checked.
          // Its active progress must not be overwritten by a duplicate-copy result.
          if (queuedAnalysis && normalizeDemoPath(queuedAnalysis.demoPath) !== filePath) {
            importProgress.update(filePath, 'skipped', { reason: 'duplicate' });
          }
          continue;
        }
        // Honor a disabled switch even during a long scan of a large library.
        if (
          (await getSettings()).analyze.autoAnalyzeFolders === false ||
          controls.paused ||
          controls.suppressed[filePath] === fingerprint ||
          controls.suppressedChecksums[demo.checksum] ||
          scanGeneration !== generation ||
          isUpdateMaintenance()
        ) {
          importProgress.update(filePath, 'skipped', { reason: 'disabled' });
          importProgress.settleWaiting('disabled');
          break;
        }
        queuedThisScan.add(demo.checksum);
        pending.set(demo.checksum, { filePath, fingerprint });
        // The existing queue owns concurrency and reports progress/errors in the Analyses page.
        // Position data is required for habits, regardless of the manual-analysis preference.
        void analysesListener
          .addDemosToAnalyses([demo], { analyzePositions: true, allowCorrupted: false, automatic: true })
          .catch((error: unknown) => {
            pending.delete(demo.checksum);
            importProgress.update(filePath, 'failed', {
              reason: 'analysis',
              message: error instanceof Error ? error.message : String(error),
            });
            logger.error('Unable to enqueue an automatic demo analysis');
            logger.error(error);
          });
      } catch (error) {
        if (fingerprint !== undefined) {
          const failure = { reason: 'unavailable', message: error instanceof Error ? error.message : String(error) };
          records.set(filePath, { fingerprint, failed: true, ...failure });
          importProgress.update(filePath, 'failed', failure);
          reportedFingerprints.set(filePath, fingerprint);
          changed = true;
        } else {
          waitingSince.delete(filePath);
          importProgress.update(filePath, 'failed', {
            reason: 'unavailable',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        logger.warn(`Automatic import failed for ${filePath}; modify the file or analyze it manually to retry`);
        logger.error(error);
      }
    }
  } catch (error) {
    logger.error('Error scanning demo folders for automatic imports');
    logger.error(error);
  } finally {
    scanning = false;
    if (progressDiscoveryStarted) {
      importProgress.finishDiscovery();
    }
    if (initialDiscoveryPending) {
      initialDiscoveryPending = false;
      importProgress.finishDiscovery();
    }
    if (changed) {
      saveRecords();
    }
  }
}

export function startAutoImportDemoFolders() {
  if (interval !== undefined) {
    return;
  }
  if (isUpdateMaintenance() || !isDatabaseConnected()) {
    return;
  }
  foldersSignature = '';
  reportedFingerprints.clear();
  initialDiscoveryPending = true;
  importProgress.beginDiscovery();
  stopCompletionListener = analysesListener.onAnalysisCompleted((analysis) => {
    const attempt = pending.get(analysis.demoChecksum);
    if (attempt === undefined) {
      // A user may retry a failed automatic import through the existing manual Analyze action.
      const record = records.get(normalizeDemoPath(analysis.demoPath));
      if (record && analysis.status === AnalysisStatus.InsertSuccess && !analysis.cacheError) {
        record.failed = false;
        record.reason = undefined;
        record.message = undefined;
        record.checksum = analysis.demoChecksum;
        saveRecords();
      }
      return;
    }
    pending.delete(analysis.demoChecksum);
    records.set(attempt.filePath, {
      fingerprint: attempt.fingerprint,
      checksum: analysis.demoChecksum,
      failed:
        analysis.status !== AnalysisStatus.Cancelled &&
        (analysis.status !== AnalysisStatus.InsertSuccess || Boolean(analysis.cacheError)),
      reason:
        analysis.status === AnalysisStatus.Cancelled
          ? 'cancelled'
          : analysis.cacheError
            ? 'cache'
            : analysis.status === AnalysisStatus.InsertError
              ? 'insertion'
              : 'analysis',
      message: analysis.cacheError ?? analysis.output.slice(-1000),
    });
    saveRecords();
  });
  interval = setInterval(() => {
    void scanFolders();
  }, scanIntervalMs);
  void scanFolders();
}

export function stopAutoImportDemoFolders() {
  clearInterval(interval);
  interval = undefined;
  generation += 1;
  readiness.clear();
  waitingSince.clear();
  deferredFiles.clear();
  importProgress.settleWaiting('stopped');
  pending.clear();
  if (initialDiscoveryPending) {
    initialDiscoveryPending = false;
    importProgress.finishDiscovery();
  }
  stopCompletionListener?.();
  stopCompletionListener = undefined;
}

export function isAutoImportScanning() {
  return scanning;
}

/** Explicit retries work even with the automatic switch off; incomplete files still cannot be inserted. */
export async function retryFailedImports() {
  if (isUpdateMaintenance()) {
    throw new Error('Application update is in progress');
  }
  const failures = importProgress.snapshot().failures;
  if (failures.length === 0) {
    return;
  }
  importProgress.beginDiscovery();
  try {
    // Cache failures are regenerated from the inserted DB, even if the source demo was moved or deleted.
    try {
      await retryFailedDemoCaches();
    } catch (error) {
      logger.error('Unable to retry one or more local demo caches');
      logger.error(error);
    }
    for (const { filePath, reason } of failures) {
      if (reason === 'cache') continue;
      try {
        await allowDemoImport(filePath);
        if (
          analysesListener
            .getAnalyses()
            .some((analysis) => normalizeDemoPath(analysis.demoPath) === normalizeDemoPath(filePath))
        ) {
          continue;
        }
        importProgress.update(filePath, 'pending');
        const fingerprint = getDemoFileFingerprint(await fs.stat(filePath));
        if (!(await hasCompleteSource2Demo(filePath))) {
          importProgress.update(filePath, 'failed', {
            reason: 'incomplete',
            message: 'Recording is incomplete or is not a supported CS2 demo.',
          });
          continue;
        }
        const demo = await getDemoFromFilePath(filePath);
        await allowDemoImport(filePath, demo.checksum);
        if (getDemoFileFingerprint(await fs.stat(filePath)) !== fingerprint) {
          importProgress.update(filePath, 'skipped', { reason: 'unstable' });
          continue;
        }
        const queuedAnalysis = analysesListener
          .getAnalyses()
          .find((analysis) => analysis.demoChecksum === demo.checksum);
        if (queuedAnalysis) {
          if (normalizeDemoPath(queuedAnalysis.demoPath) !== normalizeDemoPath(filePath)) {
            importProgress.update(filePath, 'skipped', { reason: 'duplicate' });
          }
          continue;
        }
        pending.set(demo.checksum, { filePath, fingerprint });
        reportedFingerprints.set(filePath, fingerprint);
        void analysesListener
          .addDemosToAnalyses([demo], { analyzePositions: true, allowCorrupted: false })
          .catch((error: unknown) => {
            pending.delete(demo.checksum);
            importProgress.update(filePath, 'failed', {
              reason: 'analysis',
              message: error instanceof Error ? error.message : String(error),
            });
          });
      } catch (error) {
        importProgress.update(filePath, 'failed', {
          reason: 'unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    importProgress.finishDiscovery();
  }
}
