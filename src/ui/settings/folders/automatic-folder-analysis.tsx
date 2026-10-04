import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Switch } from 'csdm/ui/components/inputs/switch';
import { SettingsEntry } from 'csdm/ui/settings/settings-entry';
import { useAnalyzeSettings } from 'csdm/ui/settings/analyze/use-analyze-settings';
import { useUpdateSettings } from 'csdm/ui/settings/use-update-settings';

export function AutomaticFolderAnalysis() {
  const { autoAnalyzeFolders } = useAnalyzeSettings();
  const updateSettings = useUpdateSettings();

  return (
    <SettingsEntry
      title={<Trans>Automatically analyze demos in these folders</Trans>}
      description={
        <Trans>
          While the app is running, complete CS2 .dem files are imported with positions for habit analysis. New and
          existing files are checked every 5 seconds after they stop changing for 10 seconds. Progress appears in
          Analyses. Failed files are retried when they change, or you can select Analyze in Demos to retry manually.
          Extract downloaded archives first.
        </Trans>
      }
      interactiveComponent={
        <Switch
          isChecked={autoAnalyzeFolders !== false}
          onChange={async (isChecked: boolean) => {
            await updateSettings({ analyze: { autoAnalyzeFolders: isChecked } });
          }}
        />
      }
    />
  );
}
