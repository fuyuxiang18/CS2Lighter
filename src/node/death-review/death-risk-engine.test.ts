import { describe, expect, it } from 'vite-plus/test';
import type {
  DeathRiskActorFrame,
  DeathRiskInput,
  DeathRiskPrecisionSample,
  DeathRiskRuleId,
} from 'csdm/common/types/death-risk';
import { buildDeathRiskReport } from './death-risk-engine';
import { collectSupportTransitions } from './risk-spatial-provider';

function player(id: string, x: number, y: number): DeathRiskActorFrame {
  return {
    id,
    alive: true,
    position: { x, y, z: 0 },
    eye: { x, y, z: 64 },
    yaw: 0,
    onGround: true,
    blind: null,
    weapon: {
      entityId: `${id}-gun`,
      name: 'ak47',
      kind: 'gun',
      magazine: 20,
      reloading: false,
      ready: true,
      deploying: false,
    },
  };
}

function fixture(endTick = 20): DeathRiskInput {
  return {
    version: 1,
    subjectId: 'self',
    enemyIds: ['a', 'b'],
    teammateIds: ['mate'],
    startTick: 0,
    deathTick: endTick,
    tickrate: 64,
    frames: Array.from({ length: endTick + 1 }, (_, tick) => ({
      tick,
      actors: [player('self', tick * 2, 0), player('a', 100, 0), player('b', 0, 100), player('mate', -100, 0)],
      lines: [
        { observerId: 'self', targetId: 'a', status: 'blocked' },
        { observerId: 'self', targetId: 'b', status: 'blocked' },
        { observerId: 'mate', targetId: 'a', status: 'blocked' },
        { observerId: 'mate', targetId: 'b', status: 'blocked' },
      ],
    })),
    shots: [],
    events: [],
    precision: [],
    aim: [],
    cover: [],
    support: [],
    interventions: [],
    coverage: {
      events: true,
      shots: true,
      weaponState: true,
      flash: true,
      precision: false,
      aim: false,
      repeekInterventions: true,
    },
  };
}

function expose(input: DeathRiskInput, id = 'a', startTick = 1) {
  for (const frame of input.frames) {
    if (frame.tick < startTick) continue;
    const line = frame.lines.find((value) => value.observerId === 'self' && value.targetId === id)!;
    line.status = 'clear';
    if (frame.tick === startTick)
      line.previousObserverPosition = { tick: startTick - 1, status: 'blocked', source: 'map:counterfactual' };
  }
}

function hurt(input: DeathRiskInput, tick = 3, actorId = 'a') {
  input.events.push({
    id: `hurt-${actorId}-${tick}`,
    kind: 'damage',
    tick,
    actorId,
    targetId: 'self',
    amount: 30,
    weaponKind: 'gun',
  });
}

function status(input: DeathRiskInput, id: DeathRiskRuleId) {
  return buildDeathRiskReport(input).evaluations.find((entry) => entry.ruleId === id)!.status;
}

function precision(input: DeathRiskInput, kind: DeathRiskPrecisionSample['kind'] = 'movement') {
  input.shots.push({ id: 's1', tick: 5, actorId: 'self', weaponEntityId: 'self-gun', weaponName: 'ak47' });
  input.precision.push({
    shotId: 's1',
    kind,
    profileSource: 'valve:verified-build:weapon',
    profileVerified: true,
    componentVerified: true,
    measurementResolutionDegrees: 0.001,
    segmentFirstShot: true,
    baselineHalfAngleDegrees: 0.2,
    actualHalfAngleDegrees: 0.8,
    targetHalfAngleDegrees: 0.5,
    targetId: 'a',
    targetGeometryVerified: true,
    targetAssociationVerified: true,
    distance: 1500,
    stableAfterTick: 8,
    landingTick: 4,
    precedingShotTick: 1,
  });
  input.coverage.precision = true;
  return input.precision[0];
}

describe('deterministic death risks', () => {
  it('retains all fourteen coverage decisions and produces no guessed risks', () => {
    const input = fixture();
    input.frames = [];
    const report = buildDeathRiskReport(input);
    expect(report.findings).toEqual([]);
    expect(report.evaluations).toHaveLength(14);
    expect(report.evaluations.find((value) => value.ruleId === 'r5')!.status).toBe('unavailable');
  });

  it('rejects an invalid bounded input without attempting analysis', () => {
    const input = fixture(4096);
    expect(buildDeathRiskReport(input).evaluations.every((value) => value.reasons.includes('invalid-input'))).toBe(
      true,
    );
  });

  it('does not analyze warmups, revives, or otherwise ineligible deaths', () => {
    const input = fixture();
    input.eligible = false;
    expose(input, 'a', 0);
    expose(input, 'b', 0);
    expect(buildDeathRiskReport(input).evaluations.every((value) => value.status === 'not-applicable')).toBe(true);
  });

  it.each([
    ['movement', 'r1'],
    ['landing', 'r2'],
    ['recovery', 'r3'],
  ] as const)('checks actual %s precision against the verified weapon state', (kind, id) => {
    const input = fixture();
    const sample = precision(input, kind);
    expect(status(input, id)).toBe('matched');
    sample.actualHalfAngleDegrees = sample.baselineHalfAngleDegrees + sample.measurementResolutionDegrees;
    expect(status(input, id)).toBe('clear');
    sample.actualHalfAngleDegrees = 0.8;
    sample.componentVerified = false;
    expect(status(input, id)).toBe('unavailable');
  });

  it('allows verified precision loss with a uniquely associated opponent without inventing a hitbox', () => {
    const input = fixture();
    const sample = precision(input);
    sample.targetGeometryVerified = false;
    sample.targetHalfAngleDegrees = null;
    expect(status(input, 'r1')).toBe('matched');
    sample.targetAssociationVerified = false;
    expect(status(input, 'r1')).toBe('unavailable');
  });

  it('projects precision at the actual distance and ranks unverified target impact below multiline exposure', () => {
    const input = fixture();
    const sample = precision(input);
    sample.targetGeometryVerified = false;
    sample.targetHalfAngleDegrees = null;
    sample.distance = 1000;
    let finding = buildDeathRiskReport(input).findings.find((value) => value.ruleId === 'r1')!;
    const radius = finding.evidence[0].values.actualRadiusUnits as number;
    expect(radius).toBeCloseTo(1000 * Math.tan((0.8 * Math.PI) / 180));
    expect(finding.priority).toBeLessThan(65);
    sample.distance = 2000;
    finding = buildDeathRiskReport(input).findings.find((value) => value.ruleId === 'r1')!;
    expect(finding.evidence[0].values.actualRadiusUnits).toBeCloseTo(radius * 2);
  });

  it('does not call a later bullet a first-shot error or a pre-landing shot a landing error', () => {
    const input = fixture();
    const sample = precision(input);
    sample.segmentFirstShot = false;
    expect(status(input, 'r1')).toBe('clear');
    sample.kind = 'landing';
    sample.landingTick = 6;
    expect(status(input, 'r2')).toBe('clear');
  });

  it('requires a preceding shot for recovery and never diagnoses an already stable shot', () => {
    const input = fixture();
    const sample = precision(input, 'recovery');
    sample.precedingShotTick = 5;
    expect(status(input, 'r3')).toBe('clear');
    sample.precedingShotTick = 1;
    sample.stableAfterTick = 5;
    expect(status(input, 'r3')).toBe('clear');
  });

  function aimFixture(pitches: number[]) {
    const input = fixture();
    input.coverage.aim = true;
    pitches.forEach((pitch, index) => {
      const id = `s${index}`;
      input.shots.push({ id, tick: index * 2, actorId: 'self', weaponEntityId: 'self-gun', weaponName: 'ak47' });
      input.aim.push({
        shotId: id,
        burstId: 'burst',
        targetId: 'a',
        verified: true,
        source: 'target-geometry:actual',
        relativePitch: pitch,
        relativeYaw: 0,
        bodyPitchMin: -1,
        bodyPitchMax: 1,
        bodyYawMin: -1,
        bodyYawMax: 1,
        maximumGapTicks: 2,
      });
    });
    return input;
  }

  it('requires target-relative sustained deviation after initially aiming at the target', () => {
    expect(status(aimFixture([0, -2, -3, -4]), 'r4')).toBe('matched');
    expect(status(aimFixture([0, -2, 0, -4]), 'r4')).toBe('clear');
    expect(status(aimFixture([-2, -3, -4, -5]), 'r4')).toBe('clear');
  });

  it('does not equate world-angle motion, invalid target association, or separated bursts with poor spray', () => {
    const input = aimFixture([0, -2, -3, -4]);
    input.aim[2].verified = false;
    expect(status(input, 'r4')).toBe('unavailable');
    input.aim[2].verified = true;
    input.aim[2].targetId = 'b';
    expect(status(input, 'r4')).toBe('clear');
    input.aim[2].targetId = 'a';
    input.shots[2].tick = 15;
    expect(status(input, 'r4')).toBe('clear');
  });

  it('detects target-relative left/right crossings independently of fixed bullet count', () => {
    const input = aimFixture([0, 0, 0, 0, 0]);
    [0, -2, 2, -2, 2].forEach((yaw, index) => (input.aim[index].relativeYaw = yaw));
    expect(status(input, 'r4')).toBe('matched');
  });

  it('times multiline exposure using actual elapsed ticks, not inclusive sample count', () => {
    const input = fixture(13);
    expose(input, 'a', 0);
    expose(input, 'b', 0);
    expect(status(input, 'r5')).toBe('matched');
    input.frames.pop();
    input.deathTick = 12;
    expect(status(input, 'r5')).toBe('clear');
  });

  it('breaks exposure continuity on missing or duplicate frames', () => {
    const input = fixture(20);
    expose(input, 'a', 0);
    expose(input, 'b', 0);
    input.frames = input.frames.filter((frame) => frame.tick !== 10);
    expect(status(input, 'r5')).toBe('unavailable');
    input.frames.push(input.frames[5]);
    expect(status(input, 'r5')).toBe('unavailable');
  });

  it('requires a counterfactual proof before attributing a new line to the player movement', () => {
    const input = fixture();
    expose(input, 'a', 0);
    expose(input, 'b', 1);
    expect(status(input, 'r6')).toBe('matched');
    delete input.frames[1].lines[1].previousObserverPosition;
    expect(status(input, 'r6')).toBe('unavailable');
  });

  it('does not count an unknown previous enemy line as zero exposure for R6', () => {
    const input = fixture();
    expose(input, 'a', 0);
    expose(input, 'b', 1);
    input.frames[0].lines[0].status = 'unknown';
    expect(status(input, 'r6')).toBe('unavailable');
    input.frames[0].lines[0].status = 'clear';
    input.frames[0].actors = input.frames[0].actors.filter((value) => value.id !== 'a');
    expect(status(input, 'r6')).toBe('unavailable');
  });

  it('shows body-control action ahead of its duplicate multiline observation', () => {
    const input = fixture();
    expose(input, 'a', 0);
    expose(input, 'b', 1);
    const report = buildDeathRiskReport(input);
    const selected = report.findings.filter((finding) => report.selectedFindingIds.includes(finding.id));
    expect(selected.map((finding) => finding.ruleId)).toEqual(['r6']);
    expect(selected[0].relatedRuleIds).toContain('r5');
  });

  it('does not infer a held grenade mistake unless the player actually creates the contact', () => {
    const input = fixture();
    expose(input);
    for (const frame of input.frames)
      frame.actors[0].weapon = {
        entityId: 'flash',
        name: 'flashbang',
        kind: 'grenade',
        magazine: null,
        reloading: null,
        ready: null,
      };
    input.coverage.weaponState = false;
    hurt(input);
    expect(status(input, 'r9')).toBe('matched');
    expect(
      buildDeathRiskReport(input).findings.find((finding) => finding.ruleId === 'r9')!.evidence[0].values.blindSource,
    ).toBeNull();
    delete input.frames[1].lines[0].previousObserverPosition;
    expect(status(input, 'r9')).toBe('unavailable');
  });

  it('does not turn grenade damage across a coincident gunline into a firearm readiness error', () => {
    const input = fixture();
    expose(input);
    for (const frame of input.frames)
      frame.actors[0].weapon = {
        entityId: 'flash',
        name: 'flashbang',
        kind: 'grenade',
        magazine: null,
        reloading: null,
        ready: null,
      };
    hurt(input);
    input.events[0].weaponKind = 'grenade';
    expect(status(input, 'r9')).toBe('clear');
    input.events[0].weaponKind = undefined;
    expect(status(input, 'r9')).not.toBe('matched');
  });

  it('does not assume the magazine was already empty when a same-tick shot emptied it', () => {
    const input = fixture();
    expose(input);
    hurt(input);
    for (const frame of input.frames.slice(1)) frame.actors[0].weapon!.magazine = 0;
    input.shots.push({ id: 'last-bullet', tick: 1, actorId: 'self', weaponEntityId: 'self-gun', weaponName: 'ak47' });
    expect(status(input, 'r11')).not.toBe('matched');
  });

  it('does not mistake a rifle fire cooldown for weapon deployment', () => {
    const input = fixture();
    expose(input);
    for (const frame of input.frames) frame.actors[0].weapon!.ready = false;
    hurt(input);
    expect(status(input, 'r9')).toBe('clear');
    for (const frame of input.frames) frame.actors[0].weapon!.deploying = true;
    expect(status(input, 'r9')).toBe('matched');
  });

  it('does not flag switching completed before the actual hit', () => {
    const input = fixture();
    expose(input);
    input.frames[1].actors[0].weapon!.deploying = true;
    input.frames[1].actors[0].weapon!.ready = false;
    hurt(input);
    expect(status(input, 'r9')).toBe('clear');
  });

  it('detects beginning a reload while already exposed, without needing movement', () => {
    const input = fixture();
    expose(input, 'a', 0);
    for (const frame of input.frames.slice(1)) frame.actors[0].weapon!.reloading = true;
    hurt(input);
    expect(status(input, 'r10')).toBe('matched');
    for (const frame of input.frames.slice(2)) frame.actors[0].weapon!.reloading = false;
    expect(status(input, 'r10')).toBe('clear');
  });

  it('does not assume a same-tick hit happened after the reload began', () => {
    const input = fixture();
    expose(input, 'a', 0);
    for (const frame of input.frames.slice(1)) frame.actors[0].weapon!.reloading = true;
    hurt(input, 1);
    expect(status(input, 'r10')).toBe('clear');
    hurt(input, 2);
    expect(status(input, 'r10')).toBe('matched');
  });

  it('requires explicitly empty ammo and separates reloads from empty-magazine contact', () => {
    const input = fixture();
    expose(input);
    hurt(input);
    for (const frame of input.frames) frame.actors[0].weapon!.magazine = 0;
    expect(status(input, 'r11')).toBe('matched');
    for (const frame of input.frames) frame.actors[0].weapon!.magazine = null;
    expect(status(input, 'r11')).not.toBe('matched');
    for (const frame of input.frames) {
      frame.actors[0].weapon!.magazine = 0;
      frame.actors[0].weapon!.reloading = true;
    }
    expect(status(input, 'r11')).not.toBe('matched');
  });

  it.each([
    ['self', 'r12'],
    ['a', 'r13'],
  ] as const)('links %s flash to self-created exposure and actual contact', (sourceId, id) => {
    const input = fixture();
    expose(input);
    hurt(input);
    for (const frame of input.frames) frame.actors[0].blind = { sourceId, startTick: 0, endTick: 4 };
    expect(status(input, id)).toBe('matched');
    for (const frame of input.frames) frame.actors[0].blind!.endTick = 2;
    expect(status(input, id)).toBe('clear');
  });

  it('does not blame stationary blinded fire or a flash that starts after the entry', () => {
    const input = fixture();
    expose(input, 'a', 0);
    hurt(input);
    for (const frame of input.frames) frame.actors[0].blind = { sourceId: 'a', startTick: 0, endTick: 20 };
    expect(status(input, 'r13')).toBe('clear');
    input.frames[0].lines[0].status = 'blocked';
    input.frames[1].lines[0].previousObserverPosition = { tick: 0, status: 'blocked', source: 'geometry' };
    for (const frame of input.frames) frame.actors[0].blind!.startTick = 2;
    expect(status(input, 'r13')).toBe('clear');
  });

  it('requires clear-contact, cover, then same-angle reentry and checks intervention', () => {
    const input = fixture();
    expose(input, 'a', 0);
    input.frames[1].lines[0].status = 'blocked';
    input.frames[2].lines[0].previousObserverPosition = { tick: 1, status: 'blocked', source: 'geometry' };
    hurt(input, 0);
    hurt(input, 3);
    expect(status(input, 'r7')).toBe('matched');
    input.interventions.push({ startTick: 1, endTick: 3, enemyId: 'a', source: 'teammate:flash' });
    expect(status(input, 'r7')).toBe('clear');
    input.coverage.repeekInterventions = false;
    expect(status(input, 'r7')).toBe('unavailable');
  });

  it('does not call a materially changed target position the same gunline', () => {
    const input = fixture();
    expose(input, 'a', 0);
    input.frames[1].lines[0].status = 'blocked';
    input.frames[2].lines[0].previousObserverPosition = { tick: 1, status: 'blocked', source: 'geometry' };
    input.frames[2].actors[1].position.y = 100;
    hurt(input, 0);
    hurt(input, 3);
    expect(status(input, 'r7')).toBe('clear');
  });

  it.each(['blocked', 'unknown', 'missing'] as const)(
    'limits reentry evidence to its own fight window ending at %s',
    (ending) => {
      const input = fixture();
      expose(input, 'a', 0);
      input.frames[1].lines[0].status = 'blocked';
      input.frames[2].lines[0].previousObserverPosition = { tick: 1, status: 'blocked', source: 'geometry' };
      hurt(input, 0);
      hurt(input, 5);
      if (ending === 'missing') input.frames = input.frames.filter((frame) => frame.tick !== 3);
      else input.frames[3].lines[0].status = ending;
      expect(status(input, 'r7')).not.toBe('matched');
    },
  );

  it('requires a currently reachable covered destination and enough time after a kill', () => {
    const input = fixture();
    expose(input, 'b', 0);
    input.events.push({ kind: 'kill', id: 'kill-a', tick: 1, actorId: 'self', targetId: 'a' });
    hurt(input, 10, 'b');
    input.cover.push({
      actorId: 'self',
      tick: 2,
      position: { x: 0, y: -20, z: 0 },
      verified: true,
      enemyIds: ['b'],
      travelTicks: 4,
      source: 'map:traversable-covered-route',
    });
    expect(status(input, 'r8')).toBe('matched');
    input.cover[0].travelTicks = 8;
    expect(status(input, 'r8')).toBe('clear');
    input.cover[0].verified = false;
    expect(status(input, 'r8')).toBe('unavailable');
  });

  function supportFixture() {
    const input = fixture();
    expose(input);
    hurt(input);
    input.frames[0].lines[1].status = 'clear';
    input.frames[0].lines[3].status = 'clear';
    input.supportTransitions = collectSupportTransitions({
      ...input,
      contexts: new Map(
        input.frames.map((frame) => [frame.tick, { tick: frame.tick, source: 'map:verified', reason: null }]),
      ),
    });
    return input;
  }

  it('requires witnessed shared support before the self-created unsupported fight', () => {
    const input = supportFixture();
    expect(status(input, 'r14')).toBe('matched');
    const finding = buildDeathRiskReport(input).findings.find((value) => value.ruleId === 'r14')!;
    expect(finding.evidence[0].targetId).toBe('b');
    expect(finding.targetIds).toEqual(['a']);
    expect(finding.evidence.some((item) => item.code === 'support-arrival-bound')).toBe(false);
    input.frames[0].lines[3].status = 'blocked';
    expect(status(input, 'r14')).toBe('unavailable');
  });

  it('cross-checks collected support transitions against every actual teammate line', () => {
    const input = supportFixture();
    input.frames[5].lines[2].status = 'clear';
    expect(status(input, 'r14')).toBe('unavailable');
  });

  it('does not turn unknown team gunlines or missing teammates into isolation evidence', () => {
    const input = supportFixture();
    input.frames[5].lines[2].status = 'unknown';
    expect(status(input, 'r14')).toBe('unavailable');
    input.frames[5].lines[2].status = 'blocked';
    input.frames[5].actors.pop();
    expect(status(input, 'r14')).toBe('unavailable');
  });

  it('does not use legacy hypothetical arrival proofs as the redesigned R14', () => {
    const input = supportFixture();
    delete input.supportTransitions;
    input.support.push({
      teammateId: 'mate',
      targetId: 'a',
      startTick: 1,
      endTick: 20,
      earliestPossibleSupportTick: 21,
      verified: true,
      source: 'navigation:verified',
    });
    expect(status(input, 'r14')).toBe('unavailable');
  });

  it('does not call a truncated or disconnected support window a complete engagement', () => {
    const input = supportFixture();
    input.frames = input.frames.filter((frame) => frame.tick !== 10);
    expect(status(input, 'r14')).toBe('unavailable');
    const other = supportFixture();
    other.supportTransitions!.observations[0].endTick = 10;
    expect(status(other, 'r14')).toBe('unavailable');
  });

  it('does not trust unsupported formation labels or a forged earlier position', () => {
    const input = supportFixture();
    input.supportTransitions!.observations[0].previousSupport.subjectPosition.x = -10;
    expect(status(input, 'r14')).toBe('unavailable');
  });

  it('never offers more than three independent risks and retains all rule decisions', () => {
    const input = fixture();
    expose(input, 'a', 0);
    expose(input, 'b', 1);
    hurt(input, 3, 'b');
    precision(input);
    for (const frame of input.frames) {
      frame.actors[0].weapon!.magazine = 0;
      frame.actors[0].blind = { sourceId: 'self', startTick: 0, endTick: 20 };
    }
    const report = buildDeathRiskReport(input);
    expect(report.selectedFindingIds.length).toBeLessThanOrEqual(3);
    expect(report.evaluations).toHaveLength(14);
    expect(report.findings.length).toBeGreaterThan(report.selectedFindingIds.length);
  });
});
