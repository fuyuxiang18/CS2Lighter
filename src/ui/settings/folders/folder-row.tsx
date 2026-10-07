import React from 'react';
import { IncludeSubFoldersSwitch } from './include-sub-folders-switch';
import { RemoveFolderButton } from './remove-folder-button';
import { RevealFolderInExplorerButton } from 'csdm/ui/components/buttons/reveal-folder-in-explorer-button';
import type { Folder } from 'csdm/node/settings/settings';

type Props = {
  folder: Folder;
};

export function FolderRow({ folder }: Props) {
  return (
    <div className="flex flex-col rounded-4 border border-gray-300 p-8">
      <p className="selectable font-semibold break-all">{folder.path}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-12">
        <IncludeSubFoldersSwitch folder={folder} />
        <div className="flex gap-x-8">
          <RevealFolderInExplorerButton path={folder.path} />
          <RemoveFolderButton folderPath={folder.path} />
        </div>
      </div>
    </div>
  );
}
