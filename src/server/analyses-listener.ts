import path from 'node:path';
import os from 'node:os';
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
import { ensureDemoCache } from 'csdm/node/demo-cache/demo-cache-service';

class AnalysesListener {
  private analyses: Analysis[] = [];
  private currentAnalyses: Analysis[] = [];
  private completionListeners = new Set<(analysis: Analysis) => void>();
  private progressHeld = false;
  // Tracks which client connections queued or wait for a demo so its pending analysis can be canceled when the last
  // of them disconnects. Demos queued by the GUI are not tracked and never canceled on disconnect.
  private clientIdsPerChecksum = new Map<string, Set<string>>();
  private outputFolderPath: string; // Folder path where CSV files will be write on the host

  public constructor() {
    this.outputFolderPath = path.resolve(os.tmpdir(), 'cs-demo-manager');
  }

  public removeDemosByChecksums(checksums: string[]) {
    this.analyses = this.analyses.filter((analysis) => {
      if (checksums.includes(analysis.demoChecksum)) {
        importProgress.update(analysis.demoPath, 'skipped', { reason: 'cancelled' });
      }
      return !checksums.includes(analysis.demoChecksum);
    });
    for (const checksum of checksums) {
      this.clientIdsPerChecksum.delete(checksum);
    }
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
      this.removeDemosByChecksums(checksums);
      server.sendPushMessage({
        name: ServerPushMessageName.DemosRemovedFromAnalyses,
        payload: checksums,
      });
    }
  }

  public async addDemosToAnalyses(
    demos: Demo[],
    options?: { analyzePositions?: boolean; clientId?: string; allowCorrupted?: boolean },
  ) {
    if (isUpdateMaintenance()) {
      throw new Error('Application update is in progress');
    }
    const clientId = options?.clientId;
    const queuedChecksums = new Set(this.getAnalyses().map((analysis) => analysis.demoChecksum));
    const demosNotInPendingAnalyses = demos.filter((demo) => {
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
    // Its per-file completion must never unlock browsing before this queue has really finished.
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
    const maxConcurrentAnalyses = Math.min(
      MAX_CONCURRENT_ANALYSES,
      settings.analyze.maxConcurrentAnalyses ?? MAX_CONCURRENT_ANALYSES / 2,
    );
    while (this.analyses.length > 0 && this.currentAnalyses.length < maxConcurrentAnalyses) {
      const analysis = this.analyses.shift();
      if (analysis) {
        // The analysis is starting: it cannot be interrupted anymore, stop tracking its owners.
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
              analysis.status === AnalysisStatus.InsertSuccess && !analysis.cacheError ? 'completed' : 'failed',
              {
                reason: analysis.cacheError
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
      if (this.analyses.length > 0) {
        await this.loopUntilAnalysesDone();
      }
    }
  }

  private readonly processAnalysis = async (analysis: Analysis, analyzePositions: boolean) => {
    const { demoChecksum: checksum, demoPath, source } = analysis;
    try {
      this.updateAnalysisStatus(analysis, AnalysisStatus.Analyzing);
      await analyzeDemo({
        demoPath,
        outputFolderPath: this.getAnalysisOutputFolderPath(analysis),
        source,
        analyzePositions: analysis.analyzePositions ?? analyzePositions,
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
      this.updateAnalysisStatus(analysis, AnalysisStatus.AnalyzeSuccess);

      await this.insertMatch(analysis, checksum, demoPath);
    } catch (error) {
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
        await this.insertMatch(analysis, checksum, demoPath);
      }
    }
  };

  private async insertMatch(analysis: Analysis, checksum: string, demoPath: string) {
    try {
      this.updateAnalysisStatus(analysis, AnalysisStatus.Inserting);
      const match = await processMatchInsertion({
        checksum,
        demoPath,
        outputFolderPath: this.getAnalysisOutputFolderPath(analysis),
      });
      this.updateAnalysisStatus(analysis, AnalysisStatus.InsertSuccess);
      try {
        importProgress.update(demoPath, 'caching');
        await ensureDemoCache(checksum, demoPath);
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
    // AnalyzeSuccess is not a completed import: keep the gate closed until database insertion has settled.
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
