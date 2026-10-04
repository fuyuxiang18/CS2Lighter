import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { getSettings } from 'csdm/node/settings/get-settings';
import { defaultSettings } from 'csdm/node/settings/default-settings';
import { getSteamApiKey, isValidSteamApiKey } from './get-steam-api-key';

vi.mock('csdm/node/settings/get-settings', () => ({ getSettings: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('optional Steam API enrichment', () => {
  it('rejects missing-key placeholders instead of making a network request', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...defaultSettings, steamApiKey: '' });
    vi.stubEnv('STEAM_API_KEYS', 'undefined');
    expect(await getSteamApiKey()).toBeUndefined();
    expect(isValidSteamApiKey('undefined')).toBe(false);
    expect(isValidSteamApiKey('null')).toBe(false);
  });

  it('works when shared keys are absent', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...defaultSettings, steamApiKey: '' });
    vi.stubEnv('STEAM_API_KEYS', undefined);
    expect(await getSteamApiKey()).toBeUndefined();
  });

  it('prefers a valid user key and filters invalid shared entries', async () => {
    const userKey = 'A'.repeat(32);
    const sharedKey = 'B'.repeat(32);
    vi.mocked(getSettings).mockResolvedValue({ ...defaultSettings, steamApiKey: userKey });
    vi.stubEnv('STEAM_API_KEYS', `undefined, ${sharedKey},`);
    expect(await getSteamApiKey()).toBe(userKey);
    vi.mocked(getSettings).mockResolvedValue({ ...defaultSettings, steamApiKey: '' });
    expect(await getSteamApiKey()).toBe(sharedKey);
  });
});
