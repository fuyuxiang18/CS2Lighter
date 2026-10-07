import React from 'react';
import { Game } from 'csdm/common/types/counter-strike';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { Maps } from 'csdm/ui/settings/maps/maps';
import { AddMapButton } from './add-map-button';
import { ResetDefaultMapsButton } from './reset-default-maps-button';

export function MapsSettings() {
  const game = Game.CS2;

  return (
    <SettingsView>
      <div className="mb-12 flex items-center gap-x-8">
        <AddMapButton game={game} />
        <ResetDefaultMapsButton game={game} />
      </div>
      <Maps game={game} />
    </SettingsView>
  );
}
