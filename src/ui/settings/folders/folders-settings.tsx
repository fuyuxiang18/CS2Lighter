import React from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { FoldersList } from './folders-list';
import { AddFolderButton } from './add-folder-button';
import { DemoArchiveExtractionSettings } from './demo-archive-extraction-settings';
import { AutomaticFolderAnalysis } from './automatic-folder-analysis';
import { useImportProgress } from 'csdm/ui/imports/import-progress-provider';
import { DemoCacheLocation } from 'csdm/ui/imports/demo-cache-location';

export function FoldersSettings() {
  const { progress } = useImportProgress();
  return (
    <SettingsView>
      <div className="flex flex-col gap-y-12">
        <AutomaticFolderAnalysis />
        <DemoArchiveExtractionSettings />
        <DemoCacheLocation directory={progress?.cacheDirectory ?? null} />
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-subtitle">
              <Trans>Folders</Trans>
            </h2>
            <AddFolderButton />
          </div>
          <FoldersList />
        </div>
      </div>
    </SettingsView>
  );
}
