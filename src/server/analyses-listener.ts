import path from 'node:path';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { server } from './server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import type { Demo } from 'csdm/common/types/demo';
import type { Analysis } from 'csdm/common/types/analysis';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';
import { processMatchInsertion } from 'csdm/node/database/matches/process-match-insertion';
import { CorruptedDemoError } from 'csdm/node/demo-analyzer/corrupted-demo-error';
import { analyzeDemo } from 'csdm/node/demo/analyze-demo';
import { getSettings } from 'csdm/node/settings/get-settings';
import { getErrorCodeFromError } from './get-error-code-from-error';
import type { ErrorCode } from 'csdm/common/error-code';
import { MAX_CONCURRENT_ANALYSES } from 'csdm/common/analyses';
import { importProgress } from 'csdm/server/import-progress';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { ensureDemoCache, cancelDemoCacheBuilds } from 'csdm/node/demo-cache/demo-cache-service';
import { fetchMatchChecksums } from 'csdm/node/database/matches/fetch-match-checksums';
import {
  allowDemoImport,
  getImportQueueControl,
  setImportQueuePaused,
  suppressDemoImport,
} from './import-queue-control';
import type { ControlImportQueuePayload } from 'csdm/common/types/import-progress';
import { getIncompleteMatchImports } from 'csdm/node/database/matches/match-import-state';
import { normalizeDemoPath } from 'csdm/common/normalize-demo-path';

class AnalysesListener {
  private analyses: Analysis[] = [];
  private currentAnalyses: Analysis[] = [];
  private completionListeners = new Set<(analysis: Analysis) => void>();
  private progressHeld = false;
  private controllers = new Map<string, AbortController>();
  private paused = false;
  private concurrency = 2;
  private insertionQueue: Promise<unknown> = Promise.resolve();

  public async restoreControls() {
    this.paused = (await getImportQueueControl()).paused;
    importProgress.setQueueState(this.paused, this.concurrency);
  }

  public async control(payload: ControlImportQueuePayload) {
    if (payload.action === 'cancel-cache') {
      cancelDemoCacheBuilds(payload.checksums);
      return;
    }
    if (payload.action === 'pause' || payload.action === 'resume') {
      this.paused = payload.action === 'pause';
      await setImportQueuePaused(this.paused);
      importProgress.setQueueState(this.paused, this.concurrency);
      if (!this.paused) void this.loopUntilAnalysesDone();
      return;
    }
    const selected = (analysis: Analysis) => !payload.checksums || payload.checksums.includes(analysis.demoChecksum);
    if (payload.action === 'remove-pending') {
      const checksums = this.analyses.filter(selected).map((analysis) => analysis.demoChecksum);
      await this.removeDemosByChecksums(checksums);
      server.sendPushMessage({ name: ServerPushMessageName.DemosRemovedFromAnalyses, payload: checksums });
    } else if (payload.action === 'cancel-active') {
      // COPY insertion is intentionally allowed to finish; only the owned raw parser is interruptible.
      for (const analysis of this.currentAnalyses.filter(selected)) {
        if (analysis.status !== AnalysisStatus.Analyzing) continue;
        await suppressDemoImport(analysis.demoPath, analysis.demoChecksum);
        if (analysis.status === AnalysisStatus.Analyzing) this.controllers.get(analysis.demoChecksum)?.abort();
      }
    }
  }
  // Tracks which client connections queued or wait for a demo so its pending analysis can be canceled when the last
  // of them disconnects. Demos queued by the GUI are not tracked and never canceled on disconnect.
  private clientIdsPerChecksum = new Map<string, Set<string>>();
  private outputFolderPath: string; // Folder path where CSV files will be write on the host

  public constructor() {
    this.outputFolderPath = path.resolve(os.tmpdir(), 'cs-demo-manager');
  }

  public async removeDemosByChecksums(checksums: string[]) {
    const removed = this.analyses.filter((analysis) => checksums.includes(analysis.demoChecksum));
    // Reserve removals synchronously, before filesystem writes yield to a finishing parser's scheduler.
    this.analyses = this.analyses.filter((analysis) => {
      if (checksums.includes(analysis.demoChecksum)) {
        importProgress.update(analysis.demoPath, 'skipped', { reason: 'cancelled' });
      }
      return !checksums.includes(analysis.demoChecksum);
    });
    for (const checksum of checksums) {
      this.clientIdsPerChecksum.delete(checksum);
    }
    for (const analysis of removed) await suppressDemoImport(analysis.demoPath, analysis.demoChecksum);
    this.releaseProgressIfIdle();
    logger.log(`checksums removed from analyses`, checksums);
  }

  public removeDemosAddedByClient(clientId: string) {
    const checksums: string[] = [];
    for (const [checksum, clientIds] of this.clientIdsPerChecksum) {
      // Cancel the analysis only when no other client is waiting for it.
      if (clientIds.delete(clientId) && clientIds.size === 0) {
        checksums.push(checksum);
      }
    }

    if (checksums.length > 0) {
      logger.log(`Removing ${checksums.length} pending analysis(es) added by the client ${clientId}`);
      void this.removeDemosByChecksums(checksums).catch((error) =>
        logger.error('Could not persist cancelled analyses', error),
      );
      server.sendPushMessage({
        name: ServerPushMessageName.DemosRemovedFromAnalyses,
        payload: checksums,
      });
    }
  }

  public async addDemosToAnalyses(
    demos: Demo[],
    options?: {
      analyzePositions?: boolean;
      clientId?: string;
      allowCorrupted?: boolean;
      force?: boolean;
      automatic?: boolean;
    },
  ) {
    if (isUpdateMaintenance()) {
      throw new Error('Application update is in progress');
    }
    const clientId = options?.clientId;
    await this.restoreControls();
    if (!options?.automatic) for (const demo of demos) await allowDemoImport(demo.filePath, demo.checksum);
    const incomplete = await getIncompleteMatchImports();
    const controls = await getImportQueueControl();
    let known = options?.force ? new Set<string>() : new Set(await fetchMatchChecksums());
    const saved = demos.filter((demo) => known.has(demo.checksum) && !incomplete.has(demo.checksum));
    for (const demo of saved) {
      // Cache format changes are rebuilt from existing DB facts, never from the raw demo.
      try {
        await ensureDemoCache(demo.checksum, demo.filePath, { retry: !options?.automatic });
        importProgress.update(demo.filePath, 'skipped', { reason: 'already-imported' });
      } catch {
        /* The cache service reports a separately retryable failure. */
      }
    }
    // A cache repair above may take seconds; another queue entry can finish in the meantime.
    if (!options?.force) known = new Set(await fetchMatchChecksums());
    const queuedChecksums = new Set(this.getAnalyses().map((analysis) => analysis.demoChecksum));
    const demosNotInPendingAnalyses = demos.filter((demo) => {
      if (options?.automatic && controls.suppressedChecksums[demo.checksum]) {
        if (
          !this.getAnalyses().some(
            (analysis) => normalizeDemoPath(analysis.demoPath) === normalizeDemoPath(demo.filePath),
          )
        ) {
          importProgress.update(demo.filePath, 'skipped', { reason: 'cancelled' });
        }
        return false;
      }
      if (incomplete.has(demo.checksum) && options?.automatic) return false;
      if (known.has(demo.checksum) && !incomplete.has(demo.checksum)) return false;
      if (queuedChecksums.has(demo.checksum)) {
        return false;
      }
      queuedChecksums.add(demo.checksum);
      return true;
    });

    if (typeof clientId === 'string') {
      // A demo may already be pending, queued by another client: record this client as an extra owner so the analysis
      // survives the other client's disconnection. Untracked pending demos were queued by the GUI, they are never
      // canceled on disconnect so there is nothing to record.
      for (const demo of demos) {
        this.clientIdsPerChecksum.get(demo.checksum)?.add(clientId);
      }
    }

    if (demosNotInPendingAnalyses.length === 0) {
      return;
    }

    const analyses = demosNotInPendingAnalyses.map((demo) => {
      const analysis: Analysis = {
        addedAt: new Date().toISOString(),
        status: AnalysisStatus.Pending,
        demoChecksum: demo.checksum,
        demoPath: demo.filePath,
        mapName: demo.mapName,
        source: demo.source,
        output: '',
        analyzePositions: options?.analyzePositions,
        allowCorrupted: options?.allowCorrupted,
      };

      return analysis;
    });
    // A concurrent profile request may read the previous cache for a manually reanalyzed match.
    // Its per-file completion must not report the background queue as finished.
    if (!this.progressHeld) {
      this.progressHeld = true;
      importProgress.beginDiscovery();
    }
    this.analyses.push(...analyses);
    for (const analysis of analyses) {
      importProgress.update(analysis.demoPath, 'pending');
    }
    if (typeof clientId === 'string') {
      for (const analysis of analyses) {
        this.clientIdsPerChecksum.set(analysis.demoChecksum, new Set([clientId]));
      }
    }

    server.sendPushMessage({
      name: ServerPushMessageName.DemosAddedToAnalyses,
      payload: analyses,
    });

    await this.loopUntilAnalysesDone();
  }

  public getAnalyses = () => {
    return [...this.analyses, ...this.currentAnalyses];
  };

  public onAnalysisCompleted(listener: (analysis: Analysis) => void) {
    this.completionListeners.add(listener);

    return () => {
      this.completionListeners.delete(listener);
    };
  }

  public hasAnalysesInProgress = () => {
    return this.hasPendingAnalyses() || this.currentAnalyses.length > 0;
  };

  public clear() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.analyses = [];
    this.currentAnalyses = [];
    this.clientIdsPerChecksum.clear();
    this.releaseProgressIfIdle();
  }

  private releaseProgressIfIdle() {
    if (this.progressHeld && !this.hasAnalysesInProgress()) {
      this.progressHeld = false;
      importProgress.finishDiscovery();
    }
  }

  private hasPendingAnalyses = () => {
    return this.analyses.length > 0;
  };

  private async loopUntilAnalysesDone() {
    const promises: Promise<void>[] = [];

    const settings = await getSettings();
    const maxConcurrentAnalyses =
      settings.analyze.automaticConcurrency !== false
        ? os.totalmem() >= 16 * 1024 ** 3 && os.availableParallelism() >= 8
          ? 3
          : 2
        : Math.max(
            1,
            Math.min(MAX_CONCURRENT_ANALYSES, settings.analyze.maxConcurrentAnalyses ?? MAX_CONCURRENT_ANALYSES / 2),
          );
    this.concurrency = maxConcurrentAnalyses;
    importProgress.setQueueState(this.paused, this.concurrency);
    while (!this.paused && this.analyses.length > 0 && this.currentAnalyses.length < maxConcurrentAnalyses) {
      const analysis = this.analyses.shift();
      if (analysis) {
        // Running analyses are only cancelled explicitly, never by a client's disconnection.
        this.clientIdsPerChecksum.delete(analysis.demoChecksum);
        this.currentAnalyses.push(analysis);
        const analysisPromise = this.processAnalysis(analysis, settings.analyze.analyzePositions)
          .catch((error) => {
            logger.error('Unhandled error during analysis');
            logger.error(error);
          })
          .finally(() => {
            importProgress.update(
              analysis.demoPath,
              analysis.status === AnalysisStatus.Cancelled
                ? 'skipped'
                : analysis.status === AnalysisStatus.InsertSuccess && !analysis.cacheError
                  ? 'completed'
                  : 'failed',
              {
                reason:
                  analysis.status === AnalysisStatus.Cancelled
                    ? 'cancelled'
                    : analysis.cacheError
                      ? 'cache'
                      : analysis.status === AnalysisStatus.InsertError
                        ? 'insertion'
                        : 'analysis',
                message:
                  analysis.cacheError ??
                  (analysis.status === AnalysisStatus.InsertSuccess ? undefined : analysis.output.slice(-1000)),
              },
            );
            this.currentAnalyses = this.currentAnalyses.filter(
              ({ demoChecksum }) => demoChecksum !== analysis.demoChecksum,
            );
            this.releaseProgressIfIdle();
            for (const listener of this.completionListeners) {
              try {
                listener(analysis);
              } catch (error) {
                logger.error('Error in analysis completion listener');
                logger.error(error);
              }
            }
          });

        promises.push(analysisPromise);
      }
    }

    if (promises.length > 0) {
      await Promise.race(promises);
      if (!this.paused && this.analyses.length > 0) {
        await this.loopUntilAnalysesDone();
      }
    }
  }

  private readonly processAnalysis = async (analysis: Analysis, analyzePositions: boolean) => {
    const { demoChecksum: checksum, demoPath, source } = analysis;
    const controller = new AbortController();
    this.controllers.set(checksum, controller);
    const startedAt = performance.now();
    try {
      this.updateAnalysisStatus(analysis, AnalysisStatus.Analyzing);
      await analyzeDemo({
        demoPath,
        outputFolderPath: this.getAnalysisOutputFolderPath(analysis),
        source,
        analyzePositions: analysis.analyzePositions ?? analyzePositions,
        signal: controller.signal,
        onStdout: (data) => {
          logger.log(data);
          analysis.output += data;
          server.sendPushMessage({
            name: ServerPushMessageName.AnalysisUpdated,
            payload: analysis,
          });
        },
        onStderr(data) {
          logger.error(data);
          analysis.output += data;
          server.sendPushMessage({
            name: ServerPushMessageName.AnalysisUpdated,
            payload: analysis,
          });
        },
      });
      logger.log(`Import timing ${checksum}: parse ${Math.round(performance.now() - startedAt)} ms`);
      this.updateAnalysisStatus(analysis, AnalysisStatus.AnalyzeSuccess);

      await this.enqueueInsertion(analysis, checksum, demoPath);
    } catch (error) {
      if (controller.signal.aborted) {
        const output = path.resolve(this.getAnalysisOutputFolderPath(analysis));
        if (path.dirname(output) === path.resolve(this.outputFolderPath)) {
          await rm(output, { recursive: true, force: true }).catch((error) =>
            logger.error('Could not remove cancelled parser output', error),
          );
        }
        this.updateAnalysisStatus(analysis, AnalysisStatus.Cancelled);
        return;
      }
      logger.error('Error while analyzing demo');
      if (error) {
        logger.error(error);
      }
      const isCorruptedDemo = error instanceof CorruptedDemoError;
      if (!isCorruptedDemo && error instanceof Error) {
        analysis.output += error.message;
      }
      this.updateAnalysisStatus(analysis, AnalysisStatus.AnalyzeError);
      // If the demo is corrupted, we still want to try to insert it in the database.
      if (isCorruptedDemo && analysis.allowCorrupted !== false) {
        await this.enqueueInsertion(analysis, checksum, demoPath);
      }
    } finally {
      this.controllers.delete(checksum);
    }
  };

  private enqueueInsertion(analysis: Analysis, checksum: string, demoPath: string) {
    const insertion = this.insertionQueue.catch(() => {}).then(() => this.insertMatch(analysis, checksum, demoPath));
    this.insertionQueue = insertion;
    return insertion;
  }

  private async insertMatch(analysis: Analysis, checksum: string, demoPath: string) {
    try {
      const insertionStarted = performance.now();
      this.updateAnalysisStatus(analysis, AnalysisStatus.Inserting);
      const match = await processMatchInsertion({
        checksum,
        demoPath,
        outputFolderPath: this.getAnalysisOutputFolderPath(analysis),
      });
      this.updateAnalysisStatus(analysis, AnalysisStatus.InsertSuccess);
      logger.log(`Import timing ${checksum}: insert ${Math.round(performance.now() - insertionStarted)} ms`);
      try {
        importProgress.update(demoPath, 'caching');
        await ensureDemoCache(checksum, demoPath, { retry: true });
      } catch (error) {
        analysis.cacheError = error instanceof Error ? error.message : String(error);
        logger.error('Match was inserted but its local cache could not be saved');
        logger.error(error);
      }
      server.sendPushMessage({
        name: ServerPushMessageName.MatchInserted,
        payload: match,
      });
    } catch (error) {
      let errorOutput: string;
      if (error instanceof Error) {
        errorOutput = error.stack ?? error.message;
        if (error.cause) {
          errorOutput += `\n${error.cause as string}`;
        }
        const jsonError = JSON.stringify(error);
        if (jsonError !== '{}') {
          errorOutput += `\n${jsonError}`;
        }
      } else {
        errorOutput = String(error);
      }
      logger.error('Error while inserting match');
      logger.error(errorOutput);
      analysis.output += errorOutput;

      this.updateAnalysisStatus(analysis, AnalysisStatus.InsertError, getErrorCodeFromError(error));
    }
  }

  private updateAnalysisStatus = (analysis: Analysis, status: AnalysisStatus, errorCode?: ErrorCode) => {
    analysis.status = status;
    analysis.errorCode = errorCode;
    // AnalyzeSuccess is not a completed import: keep reporting work until insertion has settled.
    // AnalyzeError may still enter the legacy manual recovery path; final failure is recorded in finally().
    if (status === AnalysisStatus.Analyzing) {
      importProgress.update(analysis.demoPath, 'analyzing');
    } else if (status === AnalysisStatus.AnalyzeSuccess || status === AnalysisStatus.Inserting) {
      importProgress.update(analysis.demoPath, 'inserting');
    }
    server.sendPushMessage({
      name: ServerPushMessageName.AnalysisUpdated,
      payload: analysis,
    });
  };

  private getAnalysisOutputFolderPath(analysis: Analysis) {
    return path.join(this.outputFolderPath, analysis.demoChecksum);
  }
}

export const analysesListener = new AnalysesListener();
