import { getSettings } from 'csdm/node/settings/get-settings';

export function initializeSettings() {
  // Import folders and download destinations are chosen explicitly by the user.
  return getSettings();
}
