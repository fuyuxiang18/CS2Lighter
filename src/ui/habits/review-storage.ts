import { DemoSource, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { ReviewCardId, ReviewTrainingScope } from 'csdm/common/types/review-insights';

export const reviewCardIds: ReviewCardId[] = [
  'opening-deaths',
  'opening-advantage-lost',
  'untraded-deaths',
  'team-flashes',
  'lost-clutches',
];
export type ReviewFocus = { action: string; scope: ReviewTrainingScope };
export type ReviewPreferences = {
  mapName: string;
  side: 'all' | 'ct' | 't';
  source: DemoSource | 'all';
  tab: 'review' | 'style' | 'duels' | 'progress';
  selectedCard: ReviewCardId | null;
  focus: ReviewFocus | null;
  marks: Record<string, 'reviewed' | 'context'>;
};

export function defaultReviewPreferences(): ReviewPreferences {
  return { mapName: 'all', side: 'all', source: 'all', tab: 'review', selectedCard: null, focus: null, marks: {} };
}

export function parseReviewPreferences(raw: string | null): ReviewPreferences {
  const defaults = defaultReviewPreferences();
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || value.version !== 1) return defaults;
    const data = value.data;
    if (!data || typeof data !== 'object') return defaults;
    if (typeof data.mapName === 'string' && data.mapName.length < 100) defaults.mapName = data.mapName;
    if (['all', 'ct', 't'].includes(data.side)) defaults.side = data.side;
    if (data.source === 'all' || Object.values(DemoSource).includes(data.source)) defaults.source = data.source;
    if (['review', 'style', 'duels', 'progress'].includes(data.tab)) defaults.tab = data.tab;
    if (reviewCardIds.includes(data.selectedCard)) defaults.selectedCard = data.selectedCard;
    if (data.marks && typeof data.marks === 'object') {
      defaults.marks = Object.fromEntries(
        Object.entries(data.marks)
          .filter(([key, mark]) => key.length < 200 && (mark === 'reviewed' || mark === 'context'))
          .slice(-2000),
      ) as ReviewPreferences['marks'];
    }
    const focus = data.focus;
    const scope = focus?.scope;
    if (
      typeof focus?.action === 'string' &&
      focus.action.trim().length > 0 &&
      focus.action.length <= 400 &&
      scope &&
      reviewCardIds.includes(scope.cardId) &&
      typeof scope.startedAt === 'string' &&
      Number.isFinite(Date.parse(scope.startedAt)) &&
      typeof scope.mapName === 'string' &&
      scope.mapName.length < 100 &&
      [TeamNumber.T, TeamNumber.CT].includes(scope.side) &&
      Object.values(DemoSource).includes(scope.source) &&
      Object.values(GameMode).includes(scope.gameMode) &&
      Number.isInteger(scope.buildNumber)
    ) {
      defaults.focus = { action: focus.action, scope };
    }
  } catch {
    return defaults;
  }
  return defaults;
}

export function readReviewPreferences(steamId: string): ReviewPreferences {
  try {
    return parseReviewPreferences(localStorage.getItem(`cs2lighter.review.v1.${steamId}`));
  } catch (error) {
    logger.error(error);
    return defaultReviewPreferences();
  }
}

export function saveReviewPreferences(steamId: string, preferences: ReviewPreferences) {
  localStorage.setItem(`cs2lighter.review.v1.${steamId}`, JSON.stringify({ version: 1, data: preferences }));
}
