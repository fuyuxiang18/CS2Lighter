import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Switch } from 'csdm/ui/components/inputs/switch';
import { SettingsEntry } from 'csdm/ui/settings/settings-entry';
import { useAnalyzeSettings } from './use-analyze-settings';
import { useUpdateSettings } from '../use-update-settings';

export function ToggleAnalyzePositions() {
  const updateSettings = useUpdateSettings();
  const { analyzePositions } = useAnalyzeSettings();

  return (
    <SettingsEntry
      interactiveComponent={
        <Switch
          isChecked={analyzePositions}
          onChange={async (isChecked: boolean) => {
            await updateSettings({
              analyze: {
                analyzePositions: isChecked,
              },
            });
          }}
        />
      }
      description={
        <Trans>
          Analyze player/grenade positions during manual analysis. Positions are required for habit analysis and the 2D
          viewer. Automatic folder imports always include positions. This increases import time and disk space usage.
        </Trans>
      }
      title={<Trans>Analyze player/grenade positions</Trans>}
    />
  );
}
