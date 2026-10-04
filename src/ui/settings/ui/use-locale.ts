import { useUiSettings } from './use-ui-settings';
import { getLocaleFolderName } from 'csdm/common/get-locale-folder-name';

export function useLocale() {
  const ui = useUiSettings();

  return getLocaleFolderName(ui.locale);
}
