import React from 'react';
import { Trans } from '@lingui/react/macro';
import type { SelectOption } from 'csdm/ui/components/inputs/select';
import { Select } from 'csdm/ui/components/inputs/select';
import { SettingsEntry } from 'csdm/ui/settings/settings-entry';
import { useUpdateSettings } from '../use-update-settings';
import { useAnalyzeSettings } from './use-analyze-settings';
import { MAX_CONCURRENT_ANALYSES } from 'csdm/common/analyses';

export function MaxConcurrentAnalysesSelect() {
  const { maxConcurrentAnalyses, automaticConcurrency } = useAnalyzeSettings();
  const updateSettings = useUpdateSettings();

  const options: SelectOption<number>[] = Array.from({ length: MAX_CONCURRENT_ANALYSES }, (n, i) => ({
    value: i + 1,
    label: i + 1,
  }));

  return (
    <SettingsEntry
      interactiveComponent={
        <Select
          options={[{ value: 0, label: <Trans>Automatic (recommended: 2–3)</Trans> }, ...options]}
          value={automaticConcurrency !== false ? 0 : maxConcurrentAnalyses}
          onChange={async (maxConcurrentAnalyses) => {
            await updateSettings({
              analyze: {
                automaticConcurrency: Number(maxConcurrentAnalyses) === 0,
                ...(Number(maxConcurrentAnalyses) > 0 ? { maxConcurrentAnalyses: Number(maxConcurrentAnalyses) } : {}),
              },
            });
          }}
        />
      }
      title={<Trans context="Settings title">Maximum number of concurrent analyses</Trans>}
      description={
        <Trans>
          Automatic limits disk and memory contention. Manual values are preserved; saving match data runs one at a
          time.
        </Trans>
      }
    />
  );
}
