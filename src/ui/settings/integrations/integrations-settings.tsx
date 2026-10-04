import React from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { SteamAPIKey } from './steam-api-key';

export function IntegrationsSettings() {
  return (
    <SettingsView>
      <div className="flex flex-col gap-y-8">
        <div>
          <p className="text-body-strong">
            <Trans>Steam API key</Trans>
          </p>
          <p>
            <Trans>Custom Steam API key used to retrieve information from Steam</Trans>
          </p>
        </div>
        <SteamAPIKey />
      </div>
    </SettingsView>
  );
}
