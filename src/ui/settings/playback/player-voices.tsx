import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Switch } from 'csdm/ui/components/inputs/switch';
import { SettingsEntry } from 'csdm/ui/settings/settings-entry';
import { usePlaybackSettings } from './use-playback-settings';

export function PlayerVoices() {
  const { playerVoicesEnabled, updateSettings } = usePlaybackSettings();

  const onChange = async (isChecked: boolean) => {
    await updateSettings({
      playerVoicesEnabled: isChecked,
    });
  };

  return (
    <SettingsEntry
      interactiveComponent={<Switch isChecked={playerVoicesEnabled} onChange={onChange} />}
      title={<Trans context="Settings title">Player voices</Trans>}
    />
  );
}
