import { describe, expect, it } from 'vite-plus/test';
import type { DeathRiskInput } from 'csdm/common/types/death-risk';
import { isDeathRiskInput, isDeathRiskReport } from './death-risk-cache-validation';
import { buildDeathRiskReport } from './death-risk-engine';

function fixture(): DeathRiskInput {
  return {
    version: 1,
    eligible: true,
    subjectId: 'self',
    enemyIds: ['enemy'],
    teammateIds: ['mate'],
    startTick: 0,
    deathTick: 2,
    tickrate: 64,
    frames: [0, 1, 2].map((tick) => ({
      tick,
      actors: ['self', 'enemy', 'mate'].map((id) => ({
        id,
        alive: true,
        position: { x: tick, y: 0, z: 0 },
        eye: { x: tick, y: 0, z: 64 },
        yaw: null,
        onGround: null,
        weapon: {
          entityId: `${id}:gun`,
          name: 'ak47',
          kind: 'gun',
          magazine: 20,
          reloading: false,
          ready: true,
          deploying: false,
          nextReadyTick: null,
        },
        blind: { sourceId: null, startTick: 0, endTick: 2 },
      })),
      lines: [
        {
          observerId: 'self',
          targetId: 'enemy',
          status: 'blocked',
          reason: 'map-wall',
          ...(tick > 0
            ? { previousObserverPosition: { tick: tick - 1, status: 'blocked' as const, source: 'map-proof' } }
            : {}),
        },
      ],
    })),
    shots: [{ id: 'shot-1', tick: 2, actorId: 'self', weaponEntityId: 'self:gun', weaponName: 'ak47' }],
    events: [
      { id: 'damage-1', kind: 'damage', tick: 2, actorId: 'enemy', targetId: 'self', amount: 20, weaponKind: 'gun' },
    ],
    precision: [
      {
        shotId: 'shot-1',
        kind: 'movement',
        profileSource: 'verified-profile',
        profileVerified: true,
        componentVerified: true,
        measurementResolutionDegrees: 0.001,
        segmentFirstShot: true,
        baselineHalfAngleDegrees: 0.1,
        actualHalfAngleDegrees: 1,
        targetHalfAngleDegrees: null,
        targetId: 'enemy',
        targetGeometryVerified: false,
        targetAssociationVerified: true,
        distance: 1000,
        stableAfterTick: null,
        movementSpeed: 40,
        landingTick: 0,
        precedingShotTick: 0,
      },
    ],
    aim: [
      {
        shotId: 'shot-1',
        targetId: 'enemy',
        burstId: 'burst',
        verified: true,
        source: 'target-proof',
        relativePitch: 0,
        relativeYaw: 0,
        bodyPitchMin: -1,
        bodyPitchMax: 1,
        bodyYawMin: -1,
        bodyYawMax: 1,
        maximumGapTicks: 6,
      },
    ],
    cover: [
      {
        actorId: 'self',
        tick: 1,
        position: { x: 0, y: 0, z: 0 },
        verified: true,
        enemyIds: ['enemy'],
        travelTicks: 2,
        source: 'route-proof',
      },
    ],
    support: [
      {
        teammateId: 'mate',
        targetId: 'enemy',
        startTick: 1,
        endTick: 2,
        earliestPossibleSupportTick: 3,
        verified: true,
        source: 'support-proof',
        previousSupport: { tick: 0, subjectPosition: { x: 0, y: 0, z: 0 }, source: 'previous-support' },
      },
    ],
    supportTransitions: {
      reasons: [],
      observations: [
        {
          id: 'transition',
          targetId: 'enemy',
          startTick: 1,
          endTick: 2,
          entryPosition: { x: 1, y: 0, z: 0 },
          positionBeforeEntry: { x: 0, y: 0, z: 0 },
          previousSupport: { tick: 0, targetId: 'enemy', subjectPosition: { x: 0, y: 0, z: 0 }, teammateIds: ['mate'] },
          blockedTeammateIds: ['mate'],
          displacementFromSharedPosition: 1,
          eventIds: ['damage-1'],
          sources: ['map:proof'],
        },
      ],
    },
    coverage: {
      events: true,
      shots: true,
      weaponState: true,
      flash: true,
      precision: true,
      aim: true,
      repeekInterventions: true,
    },
    interventions: [{ startTick: 0, endTick: 1, enemyId: 'enemy', source: 'flash' }],
  };
}

describe('cached death-risk facts validation', () => {
  it('accepts a complete typed input and the report generated from its JSON round trip', () => {
    const input = JSON.parse(JSON.stringify(fixture()));
    expect(isDeathRiskInput(input)).toBe(true);
    const report = buildDeathRiskReport(input);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(isDeathRiskReport(JSON.parse(JSON.stringify(report)))).toBe(true);
  });

  it.each([
    ['eligible', 'true'],
    ['frames.0.actors.0.weapon.deploying', 1],
    ['frames.0.actors.0.weapon.nextReadyTick', -1],
    ['frames.0.actors.0.weapon.ready', undefined],
    ['frames.0.actors.0.blind.sourceId', 123],
    ['frames.0.actors.0.blind.endTick', -1],
    ['frames.0.actors.0.eye.x', Infinity],
    ['frames.1.lines.0.previousObserverPosition.tick', 1],
    ['frames.1.lines.0.previousObserverPosition.source', ''],
    ['events.0.weaponKind', 'unknown'],
    ['events.0.tick', 3],
    ['events.0.amount', NaN],
    ['precision.0.componentVerified', 'true'],
    ['precision.0.measurementResolutionDegrees', -1],
    ['precision.0.targetHalfAngleDegrees', 0],
    ['precision.0.targetAssociationVerified', null],
    ['precision.0.stableAfterTick', undefined],
    ['precision.0.movementSpeed', -1],
    ['precision.0.landingTick', 1.5],
    ['precision.0.precedingShotTick', null],
    ['precision.0.shotId', 'missing'],
    ['aim.0.maximumGapTicks', 0],
    ['aim.0.bodyYawMax', -1],
    ['aim.0.verified', 'true'],
    ['support.0.earliestPossibleSupportTick', undefined],
    ['support.0.previousSupport.tick', 1],
    ['support.0.previousSupport.subjectPosition.z', '0'],
    ['support.0.previousSupport.source', ''],
    ['interventions.0.endTick', -1],
    ['coverage.flash', 1],
    ['supportTransitions.observations.0.previousSupport.tick', 1],
    ['supportTransitions.observations.0.blockedTeammateIds', ['mate', 'mate']],
    ['supportTransitions.observations.0.displacementFromSharedPosition', 0],
    ['supportTransitions.observations.0.sources', []],
  ])('rejects corrupted %s without converting an unknown into a known measurement', (path, invalid) => {
    const input = fixture();
    const keys = (path as string).split('.');
    let target = input as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = invalid;
    expect(isDeathRiskInput(input)).toBe(false);
  });

  it('accepts deliberately unknown optional states without substituting defaults', () => {
    const input = fixture();
    delete input.eligible;
    const weapon = input.frames[0].actors[0].weapon!;
    weapon.deploying = null;
    delete weapon.nextReadyTick;
    weapon.magazine = null;
    weapon.reloading = null;
    weapon.ready = null;
    input.frames[1].actors[0].weapon = null;
    delete input.events[0].weaponKind;
    input.support[0].earliestPossibleSupportTick = null;
    delete input.support[0].previousSupport;
    expect(isDeathRiskInput(input)).toBe(true);
  });

  it.each(['frames', 'shots', 'events'] as const)('rejects duplicate %s identities', (key) => {
    const input = fixture();
    if (key === 'frames') input.frames.push(input.frames[0]);
    if (key === 'shots') input.shots.push(input.shots[0]);
    if (key === 'events') input.events.push(input.events[0]);
    expect(isDeathRiskInput(input)).toBe(false);
  });

  it('rejects duplicated roster actors, frame actors and contradictory gunlines', () => {
    const input = fixture();
    input.enemyIds.push('self');
    expect(isDeathRiskInput(input)).toBe(false);
    input.enemyIds.pop();
    input.frames[0].actors.push(input.frames[0].actors[0]);
    expect(isDeathRiskInput(input)).toBe(false);
    input.frames[0].actors.pop();
    input.frames[0].lines.push({ ...input.frames[0].lines[0], status: 'clear' });
    expect(isDeathRiskInput(input)).toBe(false);
  });
});

describe('cached death-risk report validation', () => {
  it('rejects a forged complete status and misassigned or orphaned finding references', () => {
    const report = buildDeathRiskReport(fixture());
    report.status = 'unavailable';
    expect(isDeathRiskReport(report)).toBe(false);
    const original = buildDeathRiskReport(fixture());
    const matching = original.evaluations.find((item) => item.status === 'matched')!;
    matching.findingIds = [];
    matching.status = 'clear';
    expect(isDeathRiskReport(original)).toBe(false);
  });

  it('rejects reports whose evidence, selection, advice, or evaluations are corrupted', () => {
    for (const change of [
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.findings[0].evidence = [];
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.selectedFindingIds = ['missing'];
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.selectedFindingIds = [];
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.findings[0].priority = Infinity;
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.evaluations[1] = report.evaluations[0];
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.findings[0].relatedRuleIds = [report.findings[0].ruleId];
      },
      (report: ReturnType<typeof buildDeathRiskReport>) => {
        report.findings[0].evidence[0].endTick = 0;
      },
    ]) {
      const report = buildDeathRiskReport(fixture());
      change(report);
      expect(isDeathRiskReport(report)).toBe(false);
    }
  });
});
