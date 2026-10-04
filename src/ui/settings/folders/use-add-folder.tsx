import React from 'react';
import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron';
import { Trans } from '@lingui/react/macro';
import { useDispatch } from 'csdm/ui/store/use-dispatch';
import { folderAdded } from './folder-actions';
import { useUpdateSettings } from '../use-update-settings';
import { useFolders } from './use-folders';
import { useShowToast } from 'csdm/ui/components/toasts/use-show-toast';

export function useAddFolder() {
  const showToast = useShowToast();
  const dispatch = useDispatch();
  const currentFolders = useFolders();
  const updateSettings = useUpdateSettings();

  return async () => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'multiSelections'] };
    const { canceled, filePaths }: OpenDialogReturnValue = await window.csdm.showOpenDialog(options);
    if (canceled || filePaths.length === 0) {
      return;
    }

    const normalize = (value: string) => (window.csdm.isWindows ? value.toLowerCase() : value);
    const knownPaths = new Set(currentFolders.map((folder) => normalize(folder.path)));
    const newPaths = filePaths.filter((filePath) => {
      const normalizedPath = normalize(filePath);
      if (knownPaths.has(normalizedPath)) {
        return false;
      }
      knownPaths.add(normalizedPath);
      return true;
    });
    if (newPaths.length === 0) {
      showToast({
        content: <Trans>The selected folders are already in your settings</Trans>,
        type: 'warning',
      });
      return;
    }

    await updateSettings({
      demos: {
        currentFolderPath: newPaths[0],
      },
      folders: newPaths.map((folderPath) => ({ path: folderPath, includeSubFolders: true })),
    });

    for (const folderPath of newPaths) {
      dispatch(folderAdded(folderPath));
    }
  };
}
