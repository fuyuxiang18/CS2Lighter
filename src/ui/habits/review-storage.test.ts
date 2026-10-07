import { describe, expect, it } from 'vite-plus/test';
import { DemoSource, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import { defaultReviewPreferences, parseReviewPreferences } from './review-storage';

function wrap(data: unknown) {
  return JSON.stringify({ version: 1, data });
}
const focus = {
  action: 'Call a flash before throwing.',
  scope: {
    cardId: 'team-flashes',
    startedAt: '2026-10-04T05:00:00.000Z',
    mapName: 'de_inferno',
    side: TeamNumber.T,
    source: DemoSource.PerfectWorld,
    gameMode: GameMode.Competitive,
    buildNumber: 14400,
  },
};

describe('saved review preferences', () => {
  it('opens the dashboard by default while preserving existing tabs and practice data', () => {
    expect(defaultReviewPreferences().tab).toBe('overview');
    for (const tab of ['overview', 'review', 'style', 'duels', 'progress']) {
      const restored = parseReviewPreferences(wrap({ tab, focus, marks: { 'team-flashes:a:2': 'reviewed' } }));
      expect(restored.tab).toBe(tab);
      expect(restored.focus).toEqual(focus);
      expect(restored.marks).toEqual({ 'team-flashes:a:2': 'reviewed' });
    }
  });
  it('recovers from malformed or unsupported storage without losing the default workflow', () => {
    for (const value of [null, '{', 'null', '[]', JSON.stringify({ version: 9, data: { tab: 'style' } })])
      expect(parseReviewPreferences(value)).toEqual(defaultReviewPreferences());
  });
  it('preserves scenario, reviewed context and the original practice start time', () => {
    const preferences = parseReviewPreferences(
      wrap({
        mapName: 'de_inferno',
        side: 't',
        source: DemoSource.PerfectWorld,
        tab: 'progress',
        focus,
        marks: { 'opening-deaths:a:2': 'context', 'opening-deaths:b:3': 'reviewed' },
      }),
    );
    expect(preferences.focus).toEqual(focus);
    expect(preferences.tab).toBe('progress');
    expect(preferences.side).toBe('t');
    expect(preferences.marks['opening-deaths:a:2']).toBe('context');
  });
  it('rejects invalid practice dates and scenarios rather than counting unrelated matches', () => {
    for (const patch of [
      { startedAt: 'invalid' },
      { side: 99 },
      { source: 'not-a-source' },
      { gameMode: 'not-a-mode' },
      { cardId: 'made-up' },
      { buildNumber: '14400' },
    ])
      expect(
        parseReviewPreferences(wrap({ focus: { ...focus, scope: { ...focus.scope, ...patch } } })).focus,
      ).toBeNull();
  });
  it('bounds retained review marks and excludes unsupported statuses', () => {
    const marks = Object.fromEntries(Array.from({ length: 2100 }, (_, index) => [`round-${index}`, 'reviewed']));
    const result = parseReviewPreferences(
      wrap({ marks: { ...marks, wrong: 'error' }, side: 'invalid', tab: 'removed' }),
    );
    expect(Object.keys(result.marks)).toHaveLength(2000);
    expect(result.marks.wrong).toBeUndefined();
    expect(result.side).toBe('all');
    expect(result.tab).toBe('overview');
  });
});
