import React from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsCategoryButton } from 'csdm/ui/settings/settings-category-button';
import { CloseSettingsButton } from './close-settings-button';
import { SettingsCategory } from './settings-category';

export function SettingsTabs() {
  return (
    <div className="flex h-full shrink-0 flex-col overflow-y-auto border-r border-r-gray-300 bg-gray-50 p-12">
      <CloseSettingsButton />
      <SettingsCategoryButton category={SettingsCategory.UI}>
        <Trans>Appearance</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Folders}>
        <Trans>Demo import</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Maps}>
        <Trans>Maps</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Playback}>
        <Trans>Playback</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Video}>
        <Trans>Recording</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Ai}>
        <Trans>AI reviews</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.Database}>
        <Trans>Storage</Trans>
      </SettingsCategoryButton>
      <SettingsCategoryButton category={SettingsCategory.About}>
        <Trans>About</Trans>
      </SettingsCategoryButton>
    </div>
  );
}
