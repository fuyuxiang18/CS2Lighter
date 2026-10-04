import { getSettings } from 'csdm/node/settings/get-settings';

export function isValidSteamApiKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-fA-F0-9]{32}$/.test(key);
}

export async function getSteamApiKey() {
  const { steamApiKey } = await getSettings();
  if (isValidSteamApiKey(steamApiKey)) {
    return steamApiKey;
  }

  const keys = (process.env.STEAM_API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(isValidSteamApiKey);

  return keys[Math.floor(Math.random() * keys.length)];
}
