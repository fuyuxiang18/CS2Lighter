import type { Settings } from '../settings';
import type { Migration } from '../migration';

const v16: Migration = {
  schemaVersion: 16,
  run: (settings: Settings) => {
    // v0.1 shipped English fallback catalogs. Apply the requested Chinese default
    // once on upgrade; schema 16 settings keep all subsequent language choices.
    settings.ui.locale = 'zh-CN';
    return Promise.resolve(settings);
  },
};

export default v16;
