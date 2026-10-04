import React, { useState, type ReactNode } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImportFileStatus, ImportProgress } from 'csdm/common/types/import-progress';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { Content } from 'csdm/ui/components/content';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { useImportProgress } from './import-progress-provider';

export function ImportProgressGate({ children }: { children: ReactNode }) {
  const { progress, failed, refresh } = useImportProgress();
  const { openSettings } = useSettingsOverlay();

  if (!progress) {
    return (
      <Content>
        <div className="flex flex-col gap-16 text-gray-900" role="status">
          <h1 className="text-title">
            <Trans>Preparing your demo library</Trans>
          </h1>
          {failed ? (
            <p role="alert">
              <Trans>Import status is unavailable. Retry the connection to continue.</Trans>
            </p>
          ) : (
            <p>
              <Trans>Checking folder and analysis progress…</Trans>
            </p>
          )}
          <div className="flex flex-wrap gap-12">
            {failed && (
              <Button onClick={refresh}>
                <Trans>Retry connection</Trans>
              </Button>
            )}
            <Button onClick={() => openSettings(SettingsCategory.Folders)}>
              <Trans>Manage demo folders</Trans>
            </Button>
          </div>
        </div>
      </Content>
    );
  }

  if (progress.isBlocking)
    return (
      <Content>
        <ImportProgressDetails progress={progress} />
      </Content>
    );

  return (
    <>
      {progress.failures.length > 0 && (
        <details className="max-h-full shrink-0 overflow-y-auto border-b border-orange-500 bg-gray-50 p-12 text-gray-900">
          <summary className="cursor-pointer text-orange-500">
            <Trans>Some demo files need attention</Trans>
          </summary>
          <ImportProgressDetails progress={progress} />
        </details>
      )}
      {children}
    </>
  );
}

function ImportProgressDetails({ progress }: { progress: ImportProgress }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const { openSettings } = useSettingsOverlay();
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const completed = progress.completed;
  const total = progress.total;
  const settled = progress.settled;
  const failed = progress.failed;
  const skipped = progress.skipped;
  const waiting = progress.waiting;
  const pending = progress.pending;
  const statusLabels: Record<ImportFileStatus, string> = {
    waiting: t`Waiting for file to finish writing`,
    pending: t`Queued`,
    analyzing: t`Parsing demo`,
    inserting: t`Saving match data`,
    completed: t`Ready`,
    failed: t`Failed`,
    skipped: t`Skipped`,
  };
  const reasonLabels: Record<string, string> = {
    incomplete: t`This recording is incomplete or is not a supported CS2 demo.`,
    unstable: t`This file is still changing. It will be checked again automatically.`,
    analysis: t`The demo could not be parsed. Check the file and retry.`,
    insertion: t`The parsed match could not be saved. Check the database and retry.`,
    unavailable: t`The file could not be read. Check that the folder is available.`,
    cancelled: t`Analysis was cancelled. Retry when you are ready.`,
    stopped: t`Import stopped before this file was ready.`,
  };
  const retry = async () => {
    setRetrying(true);
    setRetryFailed(false);
    try {
      await client.send({ name: RendererClientMessageName.RetryFailedImports });
    } catch (error) {
      logger.error(error);
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-16 py-12 text-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="min-w-0">
          <h1 className="text-title">
            {progress.isBlocking ? <Trans>Preparing your demo library</Trans> : <Trans>Import results</Trans>}
          </h1>
          <p className="mt-8 text-gray-700">
            {progress.isBlocking ? (
              <Trans>Browsing will unlock when this batch finishes. You can still manage folders and settings.</Trans>
            ) : (
              <Trans>Ready matches are available. Review the files below before retrying.</Trans>
            )}
          </p>
        </div>
        <Button onClick={() => openSettings(SettingsCategory.Folders)}>
          <Trans>Manage demo folders</Trans>
        </Button>
      </div>
      <div className="flex flex-col gap-8" role="status">
        <div className="flex flex-wrap justify-between gap-8 text-body-strong">
          <p>
            {progress.phase === 'discovering' ? (
              <Trans>Finding demo files…</Trans>
            ) : (
              <Trans>
                {settled} of {total} files processed
              </Trans>
            )}
          </p>
          <p>{percent}%</p>
        </div>
        <div
          role="progressbar"
          aria-label={t`Demo import progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-12 overflow-hidden rounded-full bg-gray-300"
        >
          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-gray-700">
          <Trans>
            {completed} ready · {failed} failed · {skipped} skipped · {waiting} waiting · {pending} queued
          </Trans>
        </p>
        <p className="text-caption text-gray-700">
          <Trans>Progress counts files that have finished processing, including failures and skips.</Trans>
        </p>
      </div>
      {progress.currentFiles.length > 0 && (
        <ul className="flex flex-col gap-8">
          {progress.currentFiles.map((file) => (
            <li
              key={file.filePath}
              className="flex flex-wrap items-start justify-between gap-8 rounded-4 border border-gray-300 p-12"
            >
              <p className="min-w-0 flex-1 break-all">{file.filePath}</p>
              <p className="shrink-0 text-blue-500">{statusLabels[file.status]}</p>
            </li>
          ))}
        </ul>
      )}
      {progress.failures.length > 0 && (
        <div className="flex flex-col gap-12">
          <h2 className="text-subtitle">
            <Trans>Files to review</Trans>
          </h2>
          {progress.failures.map((failure) => (
            <div key={failure.filePath} className="rounded-4 border border-gray-300 p-12">
              <p className="text-body-strong break-all">{failure.filePath}</p>
              <p className="mt-4 wrap-break-word text-orange-500">
                {reasonLabels[failure.reason] ?? t`This demo could not be imported.`}
              </p>
              {failure.message && (
                <details className="mt-8 text-caption text-gray-700">
                  <summary className="cursor-pointer">
                    <Trans>Technical details</Trans>
                  </summary>
                  <p className="mt-4 break-all">{failure.message}</p>
                </details>
              )}
            </div>
          ))}
          {!progress.isBlocking && (
            <Button isDisabled={retrying} onClick={retry}>
              <Trans>Retry files needing attention</Trans>
            </Button>
          )}
          {retryFailed && (
            <p role="alert" className="text-red-500">
              <Trans>Retry could not start. Check the folders and try again.</Trans>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
