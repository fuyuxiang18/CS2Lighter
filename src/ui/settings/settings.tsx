import React from 'react';
import { AiSettings } from './ai/ai-settings';
import { DatabaseSettings } from './database/database-settings';
import { FoldersSettings } from './folders/folders-settings';
import { VideoSettings } from './video/video-settings';
import { MapsSettings } from './maps/maps-settings';
import { SettingsCategory } from './settings-category';
import { UiSettings } from './ui/ui-settings';
import { useSettingsOverlay } from './use-settings-overlay';
import { PlaybackSettings } from './playback/playback-settings';
import { assertNever } from 'csdm/common/assert-never';
import { About } from './about/about';

export function Settings() {
  const { category } = useSettingsOverlay();

  switch (category) {
    case SettingsCategory.Ai:
      return <AiSettings />;
    case SettingsCategory.Folders:
      return <FoldersSettings />;
    case SettingsCategory.Database:
      return <DatabaseSettings />;
    case SettingsCategory.UI:
      return <UiSettings />;
    case SettingsCategory.Analyze:
      return <FoldersSettings />;
    case SettingsCategory.Playback:
      return <PlaybackSettings />;
    case SettingsCategory.Video:
      return <VideoSettings />;
    case SettingsCategory.Maps:
      return <MapsSettings />;
    case SettingsCategory.About:
      return <About />;
    default:
      return assertNever(category, `Unknown settings category: ${category as string}`);
  }
}
