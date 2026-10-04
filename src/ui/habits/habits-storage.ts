export type HabitsIdentity = {
  nickname: string;
  steamId: string | null;
};

export type LearningNote = {
  id: string;
  checksum: string;
  mapName: string;
  playerName: string;
  steamId: string;
  roundNumber: number;
  note: string;
  createdAt: string;
};

const IDENTITY_KEY = 'cs-tactics.identity.v1';
const NOTES_KEY = 'cs-tactics.learning-notes.v1';

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

export function readLearningNotes(): LearningNote[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]');
    if (Array.isArray(value)) {
      return value.filter((note): note is LearningNote => {
        return (
          note !== null &&
          typeof note === 'object' &&
          typeof note.id === 'string' &&
          typeof note.checksum === 'string' &&
          typeof note.mapName === 'string' &&
          typeof note.playerName === 'string' &&
          typeof note.steamId === 'string' &&
          Number.isInteger(note.roundNumber) &&
          note.roundNumber > 0 &&
          typeof note.note === 'string' &&
          typeof note.createdAt === 'string'
        );
      });
    }
  } catch (error) {
    logger.error('Unable to read saved learning notes');
    logger.error(error);
  }
  return [];
}

export function saveLearningNotes(notes: LearningNote[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}
