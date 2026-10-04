import React from 'react';
import { AnalysesLink } from './analyses-link';
import { SettingsButton } from './settings-button';
import { PinnedPlayerLink } from './pinned-player-link';
import { PlayersLink } from './players-link';
import { BansLink } from './bans-link';
import { MatchesLink } from './matches-link';
import { DemosLink } from './demos-link';
import { SearchLink } from './search-link';
import { TeamsLink } from './teams-link';
import { VideoQueueLink } from './video-queue-link';
import { HabitsLinks } from 'csdm/ui/habits/habits-links';
import { useImportProgress } from 'csdm/ui/imports/import-progress-provider';

export function LeftBar() {
  const { progress } = useImportProgress();
  const isBlocked = !progress || progress.isBlocking;
  return (
    <div className="flex no-scrollbar h-full shrink-0 flex-col items-center overflow-y-auto border-r border-r-gray-300 bg-gray-50">
      <div className="flex w-48 flex-col items-center" inert={isBlocked} aria-disabled={isBlocked}>
        <HabitsLinks />
        <PinnedPlayerLink />
        <div className="my-8 flex w-full px-12">
          <div className="h-px w-full bg-gray-600" />
        </div>
        <MatchesLink />
        <DemosLink />
        <PlayersLink />
        <TeamsLink />
        <BansLink />
        <SearchLink />
        <AnalysesLink />
        <VideoQueueLink />
      </div>
      <SettingsButton />
    </div>
  );
}
