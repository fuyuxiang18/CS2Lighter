import { describe, expect, it } from 'vite-plus/test';
import type { DeathRiskActorFrame, DeathRiskFrame } from 'csdm/common/types/death-risk';
import { collectSupportTransitions } from './risk-spatial-provider';

type Input = Parameters<typeof collectSupportTransitions>[0];

function player(id: string, x: number): DeathRiskActorFrame {
  return {
    id,
    alive: true,
    position: { x, y: 0, z: 0 },
    eye: { x, y: 0, z: 64 },
    yaw: 0,
    onGround: true,
    blind: null,
    weapon: { entityId: `gun:${id}`, name: 'ak47', kind: 'gun', magazine: 30, reloading: false, ready: true },
  };
}

function fixture(): Input {
  const frames: DeathRiskFrame[] = Array.from({ length: 4 }, (_, tick) => ({
    tick,
    actors: [player('you', tick * 4), player('teammate', -100), player('old-target', 500), player('new-target', 600)],
    lines: [
      { observerId: 'you', targetId: 'old-target', status: tick === 0 ? 'clear' : 'blocked' },
      { observerId: 'teammate', targetId: 'old-target', status: 'clear' },
      {
        observerId: 'you',
        targetId: 'new-target',
        status: tick >= 2 ? 'clear' : 'blocked',
        ...(tick === 2
          ? { previousObserverPosition: { tick: 1, status: 'blocked' as const, source: 'map:counterfactual:2' } }
          : {}),
      },
      { observerId: 'teammate', targetId: 'new-target', status: 'blocked' },
    ],
  }));
  return {
    subjectId: 'you',
    teammateIds: ['teammate'],
    enemyIds: ['old-target', 'new-target'],
    startTick: 0,
    deathTick: 3,
    frames,
    contexts: new Map(
      frames.map((frame) => [frame.tick, { tick: frame.tick, source: `map:fixture:${frame.tick}`, reason: null }]),
    ),
    events: [
      { id: 'hit', kind: 'damage', weaponKind: 'gun', actorId: 'new-target', targetId: 'you', amount: 50, tick: 3 },
    ],
    coverage: { events: true, flash: true, weaponState: true },
  };
}

describe('witnessed support transition evidence', () => {
  it('retains the two actual targets, positions and times without claiming every route was unreachable', () => {
    const result = collectSupportTransitions(fixture());
    expect(result.reasons).toEqual([]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      targetId: 'new-target',
      startTick: 2,
      endTick: 3,
      entryPosition: { x: 8, y: 0, z: 0 },
      previousSupport: {
        tick: 0,
        targetId: 'old-target',
        subjectPosition: { x: 0, y: 0, z: 0 },
        teammateIds: ['teammate'],
      },
      blockedTeammateIds: ['teammate'],
      displacementFromSharedPosition: 8,
      eventIds: ['hit'],
    });
    expect(result.observations[0]).not.toHaveProperty('earliestPossibleSupportTick');
    expect(result.observations[0].sources).toContain('map:counterfactual:2');
  });

  it('does not call a clear teammate line absent just because that teammate holds an empty gun', () => {
    const input = fixture();
    input.frames[3].lines.find((line) => line.observerId === 'teammate' && line.targetId === 'new-target')!.status =
      'clear';
    input.frames[3].actors.find((actor) => actor.id === 'teammate')!.weapon!.magazine = 0;
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('requires a witnessed earlier shared gunline with both guns ready', () => {
    const input = fixture();
    input.frames[0].actors.find((actor) => actor.id === 'teammate')!.weapon!.ready = null;
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('reports missing earlier teammate rays as unknown rather than no formation change', () => {
    const input = fixture();
    input.frames[0].lines = input.frames[0].lines.filter(
      (line) => !(line.observerId === 'teammate' && line.targetId === 'old-target'),
    );
    const result = collectSupportTransitions(input);
    expect(result.observations).toEqual([]);
    expect(result.reasons).toContain('earlier-support-gunline-unknown');
  });

  it('requires evidence that the subject created the new line, not just enemy movement', () => {
    const input = fixture();
    delete input.frames[2].lines.find((line) => line.targetId === 'new-target' && line.observerId === 'you')!
      .previousObserverPosition;
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('does not turn missing or smoky teammate lines into unavailable assistance', () => {
    const input = fixture();
    input.frames[3].lines.find((line) => line.observerId === 'teammate' && line.targetId === 'new-target')!.status =
      'unknown';
    const result = collectSupportTransitions(input);
    expect(result.observations).toEqual([]);
    expect(result.reasons).toContain('teammate-gunline-unknown');
  });

  it('does not use an unfinished or interrupted contact window', () => {
    const input = fixture();
    input.deathTick = 4;
    const result = collectSupportTransitions(input);
    expect(result.observations).toEqual([]);
    expect(result.reasons).toContain('support-contact-window-incomplete');
  });

  it('requires the complete environment at both the earlier and current positions', () => {
    const input = fixture();
    input.contexts = new Map(input.contexts).set(0, { tick: 0, source: 'map:fixture:0', reason: 'dynamic-incomplete' });
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('does not connect a previous shared line across missing frames', () => {
    const input = fixture();
    input.frames = input.frames.filter((frame) => frame.tick !== 1);
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('does not treat distant grenade damage as a gunfight on the new line', () => {
    const input = fixture();
    input.events[0].weaponKind = 'grenade';
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('does not turn an unverified flash baseline into a clear earlier teammate view', () => {
    const input = fixture();
    input.coverage.flash = false;
    expect(collectSupportTransitions(input)).toEqual({
      observations: [],
      reasons: ['support-transition-coverage-incomplete'],
    });
  });

  it('does not label a solo situation as leaving support', () => {
    const input = fixture();
    for (const frame of input.frames) frame.actors.find((actor) => actor.id === 'teammate')!.alive = false;
    expect(collectSupportTransitions(input).observations).toEqual([]);
  });

  it('rejects duplicate ticks rather than choosing a convenient state', () => {
    const input = fixture();
    input.frames.push(structuredClone(input.frames[2]));
    expect(collectSupportTransitions(input)).toEqual({ observations: [], reasons: ['duplicate-spatial-tick'] });
  });
});
