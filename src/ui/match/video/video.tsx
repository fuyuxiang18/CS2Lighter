import React from 'react';
import { AddNewSequenceButton } from 'csdm/ui/match/video/sequences/add-new-sequence-button';
import { Content } from 'csdm/ui/components/content';
import { SequencesTimeline } from './sequences/sequences-timelines/sequences-timeline';
import { AddVideoToQueueButton } from './add-video-to-queue-button';
import { GeneratePlayerSequencesButton } from './generate-player-sequences-button';
import { SequencesSummary } from './sequences-summary';
import { EditSequencesSettingsButton } from './sequences/edit-sequences/edit-sequences-settings-button';
import { WatchSequencesButton } from './watch-sequences-button';
import { VideoActionsMenu } from './video-actions-menu';

export function MatchVideo() {
  return (
    <Content>
      <div className="flex min-w-0 flex-col gap-12">
        <div className="flex flex-wrap items-center gap-8">
          <AddVideoToQueueButton />
          <AddNewSequenceButton />
          <GeneratePlayerSequencesButton />
          <EditSequencesSettingsButton />
          <WatchSequencesButton />
          <VideoActionsMenu />
          <SequencesSummary />
        </div>
        <div className="mt-12">
          <SequencesTimeline />
        </div>
      </div>
    </Content>
  );
}
