import type { Settings } from '../settings';
import type { Migration } from '../migration';

const initializeLocale: Migration = {
  schemaVersion: 1,
  run: (settings: Settings) => {
    settings.ui.locale = 'zh-CN';

    return Promise.resolve(settings);
  },
};

export default initializeLocale;
