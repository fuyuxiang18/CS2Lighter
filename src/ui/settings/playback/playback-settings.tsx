import React from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { LaunchParameters } from './launch-parameters';
import { GameDisplayMode } from './game-display-mode';
import { GameHeight } from './game-height';
import { GameWidth } from './game-width';
import { HighlightsWatchBeforeKillDelay } from './highlights-watch-before-kill-delay';
import { HighlightsWatchAfterKillDelay } from './highlights-watch-after-kill-delay';
import { LowlightsWatchBeforeKillDelay } from './lowlights-watch-before-kill-delay';
import { LowlightsWatchAfterKillDelay } from './lowlights-watch-after-kill-delay';
import { WatchRoundBeforeDelay } from './watch-round-before-delay';
import { WatchRoundAfterDelay } from './watch-round-after-delay';
import { UseHlae } from './use-hlae';
import { PlayerVoices } from './player-voices';
import { HighlightsIncludeDamages } from './highlights-include-damages';
import { LowlightsIncludeDamages } from './lowlights-include-damages';
import { Cs2PluginSelect } from './cs2-plugin-select';
import { Cs2Location } from './cs2-location';
import { FollowSymbolicLinks } from './follow-symbolic-links';
import { SteamRuntimeScriptLocation } from './steam-runtime-script-location';
import { WatchRoundWaitRoundEnd } from './watch-round-wait-round-end';

export function PlaybackSettings() {
  return (
    <SettingsView>
      <GameWidth />
      <GameHeight />
      <GameDisplayMode />
      <PlayerVoices />
      {!window.csdm.isMac && <Cs2Location />}
      <details className="mt-12">
        <summary className="cursor-pointer text-body-strong">
          <Trans>Advanced playback</Trans>
        </summary>
        <div className="mt-12 flex flex-col gap-12">
          <LaunchParameters />
          <HighlightsWatchBeforeKillDelay />
          <HighlightsWatchAfterKillDelay />
          <HighlightsIncludeDamages />
          <LowlightsWatchBeforeKillDelay />
          <LowlightsWatchAfterKillDelay />
          <LowlightsIncludeDamages />
          <WatchRoundBeforeDelay />
          <WatchRoundAfterDelay />
          <WatchRoundWaitRoundEnd />
          {window.csdm.isWindows && <UseHlae />}
          {!window.csdm.isMac && (
            <>
              <Cs2PluginSelect />
              {window.csdm.isLinux && (
                <>
                  <FollowSymbolicLinks />
                  <SteamRuntimeScriptLocation />
                </>
              )}
            </>
          )}
        </div>
      </details>
    </SettingsView>
  );
}
