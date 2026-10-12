import { describe, expect, it } from 'vite-plus/test';
import type { DeathRiskFinding, DeathRiskReport } from 'csdm/common/types/death-risk';
import { deathRiskPresentation } from './death-review-presentation';

function report(overrides: Partial<DeathRiskReport> = {}): DeathRiskReport {
  return {
    version: 1,
    ruleRevision: 'test',
    status: 'unavailable',
    findings: [],
    selectedFindingIds: [],
    evaluations: [],
    ...overrides,
  };
}

describe('death review conclusion states', () => {
  it('keeps an old cache without operation rules distinct from an inspected death', () => {
    expect(deathRiskPresentation(undefined).status).toBe('not-analyzed');
    expect(deathRiskPresentation(report()).status).toBe('insufficient');
  });

  it('never calls a death safe when its relevant evidence is unavailable', () => {
    expect(
      deathRiskPresentation(
        report({
          evaluations: [
            { ruleId: 'r1', status: 'unavailable', reasons: ['weapon-profile-missing'], findingIds: [] },
            { ruleId: 'r10', status: 'not-applicable', reasons: [], findingIds: [] },
          ],
        }),
      ).status,
    ).toBe('insufficient');
  });

  it('distinguishes a partially checked report from full negative coverage', () => {
    const evaluations: DeathRiskReport['evaluations'] = [
      { ruleId: 'r5', status: 'clear', reasons: [], findingIds: [] },
    ];
    expect(deathRiskPresentation(report({ status: 'partial', evaluations })).status).toBe('partial-clear');
    expect(deathRiskPresentation(report({ status: 'evaluated', evaluations })).status).toBe('clear');
  });

  it('does not describe an inapplicable event as an absence of mistakes', () => {
    expect(
      deathRiskPresentation(
        report({ evaluations: [{ ruleId: 'r1', status: 'not-applicable', reasons: [], findingIds: [] }] }),
      ).status,
    ).toBe('not-applicable');
  });

  it('shows the engine selection in its ranking order with at most three conclusions', () => {
    const findings: DeathRiskFinding[] = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      ruleId: 'r9',
      relatedRuleIds: [],
      startTick: 10,
      endTick: 20,
      priority: 1,
      targetIds: [],
      evidence: [],
      advice: { code: 'ready-weapon-before-peeking', values: {} },
    }));
    const result = deathRiskPresentation(report({ findings, selectedFindingIds: ['missing', 'd', 'b', 'a', 'c'] }));
    expect(result.status).toBe('risks');
    expect(result.findings.map((finding) => finding.id)).toEqual(['d', 'b', 'a']);
  });
});
