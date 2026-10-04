export type HabitsIdentity = {
  nickname: string;
  steamId: string | null;
};

const IDENTITY_KEY = 'cs-tactics.identity.v1';

export function readHabitsIdentity(): HabitsIdentity | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null');
    if (
      value !== null &&
      typeof value === 'object' &&
      'nickname' in value &&
      typeof value.nickname === 'string' &&
      'steamId' in value &&
      (value.steamId === null || (typeof value.steamId === 'string' && /^\d{17}$/.test(value.steamId)))
    ) {
      return { nickname: value.nickname, steamId: value.steamId };
    }
  } catch (error) {
    logger.error('Unable to read the saved habits identity');
    logger.error(error);
  }
  return null;
}

export function saveHabitsIdentity(identity: HabitsIdentity | null) {
  if (identity) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } else {
    localStorage.removeItem(IDENTITY_KEY);
  }
}

// Legacy learning notes remain untouched in local storage for compatibility.
