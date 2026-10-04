import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useImportProgress } from 'csdm/ui/imports/import-progress-provider';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';

export function ImportSummary() {
  const { t } = useLingui();
  const { progress, failed } = useImportProgress();
  const { openSettings } = useSettingsOverlay();
  const busy = progress?.isBlocking ?? true;
  const needsAttention = failed || Boolean(progress?.failures.length);
  const settled = progress?.settled ?? 0;
  const total = progress?.total ?? 0;
  const percent = progress?.percent ?? 0;
  return (
    <button
      type="button"
      aria-label={t`Manage imports and cache`}
      onClick={() => openSettings(SettingsCategory.Folders)}
      className="flex w-full cursor-pointer flex-col gap-8 rounded-12 border border-gray-300 bg-gray-100 p-12 text-left transition-colors duration-85 hover:border-gray-400 hover:bg-gray-200"
    >
      <span className="text-body-strong text-gray-900">
        <Trans>Imports & cache</Trans>
      </span>
      <span className="flex items-start gap-8 text-caption text-gray-700">
        <span
          aria-hidden="true"
          className={`mt-4 size-8 shrink-0 rounded-full ${needsAttention ? 'bg-orange-500' : busy ? 'bg-blue-500' : 'bg-accent'}`}
        />
        <span>
          {failed ? (
            <Trans>Import status unavailable</Trans>
          ) : busy ? (
            total > 0 ? (
              <Trans>
                {settled} / {total} processed
              </Trans>
            ) : (
              <Trans>Checking local files</Trans>
            )
          ) : needsAttention ? (
            <Trans>Files need attention</Trans>
          ) : (
            <Trans>Local library ready</Trans>
          )}
        </span>
      </span>
      {busy && total > 0 && (
        <span
          className="h-4 w-full overflow-hidden rounded-full bg-gray-300"
          role="progressbar"
          aria-label={t`Demo import progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </span>
      )}
      <span className="text-caption text-gray-600">
        <Trans>Manage folders →</Trans>
      </span>
    </button>
  );
}
