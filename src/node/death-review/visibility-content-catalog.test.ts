import { describe, expect, it } from 'vite-plus/test';
import { getVisibilityContentExpectation } from './visibility-content-catalog';

describe('recorded patch content cohorts', () => {
  it('accepts the verified, closed 14190 release cohort', () => {
    expect(getVisibilityContentExpectation(14190, 'de_mirage')).toEqual({
      size: 176187297,
      sha1: '0def8c7402b1ecf6d387f6e559d210b5a1856b32',
      manifestIds: ['4758919807587010422'],
    });
  });
  it('rejects the open 14191 cohort even for maps whose observed releases currently agree', () => {
    for (const map of ['de_ancient', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke']) {
      expect(getVisibilityContentExpectation(14191, map)).toBeNull();
    }
  });
  it('includes the complete single-release 14190 cohort without extrapolating to earlier patches', () => {
    expect(getVisibilityContentExpectation(14190, 'de_mirage')?.manifestIds).toEqual(['4758919807587010422']);
    expect(getVisibilityContentExpectation(14175, 'de_mirage')).toBeNull();
    expect(getVisibilityContentExpectation(14191, 'de_unknown')).toBeNull();
    expect(getVisibilityContentExpectation(14191, '__proto__')).toBeNull();
    expect(getVisibilityContentExpectation(14192, 'de_mirage')).toBeNull();
  });
});
