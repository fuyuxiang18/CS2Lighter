import { describe, expect, it } from 'vite-plus/test';
import type { DeathRiskActorFrame, DeathRiskFrame } from 'csdm/common/types/death-risk';
import type { GunlineFrameContext } from './gunline-evidence';
import { collectPostKillCoverDepartures } from './cover-proof-provider';

type Input = Parameters<typeof collectPostKillCoverDepartures>[0];
function player(id: string, x: number): DeathRiskActorFrame {
  return {
    id,
    alive: true,
    position: { x, y: 0, z: 0 },
    eye: { x, y: 0, z: 64 },
    yaw: 0,
    weapon: null,
    onGround: true,
    blind: null,
  };
}
function fixture(): Input {
  const frames: DeathRiskFrame[] = Array.from({ length: 7 }, (_, tick) => ({
    tick,
    actors: [
      player('you', tick >= 3 ? 10 : 0),
      { ...player('killed', 100), alive: tick === 0 },
      player('next', 200),
      player('other', 300),
    ],
    lines: [
      { observerId: 'you', targetId: 'killed', status: tick === 0 ? 'clear' : 'blocked' },
      { observerId: 'you', targetId: 'next', status: tick >= 3 ? 'clear' : 'blocked' },
      { observerId: 'you', targetId: 'other', status: 'blocked' },
    ],
  }));
  const contexts = new Map<number, GunlineFrameContext>(
    frames.map((frame) => [
      frame.tick,
      {
        tick: frame.tick,
        source: `map:fixture:${frame.tick}`,
        reason: null,
        trace: (from) => Promise.resolve({ status: from[0] === 0 ? 'blocked' : 'clear', reason: 'occluded', rays: [] }),
      },
    ]),
  );
  return {
    subjectId: 'you',
    enemyIds: ['killed', 'next', 'other'],
    startTick: 0,
    deathTick: 6,
    frames,
    contexts,
    coverage: { events: true },
    events: [
      { id: 'kill', kind: 'kill', actorId: 'you', targetId: 'killed', tick: 0, weaponKind: 'gun' },
      { id: 'hit', kind: 'damage', actorId: 'next', targetId: 'you', tick: 5, amount: 25, weaponKind: 'gun' },
    ],
  };
}

describe('post-kill departure from witnessed cover', () => {
  it('checks the old eye against every current live enemy, retaining exact events and positions', async () => {
    const input = fixture();
    const calls: number[][] = [];
    for (const context of input.contexts.values()) {
      context.trace = (from, to) => {
        calls.push([context.tick, from[0], to[0]]);
        return Promise.resolve({ status: 'blocked', reason: 'occluded', rays: [] });
      };
    }
    const result = await collectPostKillCoverDepartures(input);
    expect(result.reasons).toEqual([]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      actorId: 'you',
      killEventId: 'kill',
      killTick: 0,
      coverTick: 2,
      entryTick: 3,
      endTick: 5,
      hitEventId: 'hit',
      attackerId: 'next',
      enemyIds: ['next'],
      coverPosition: { x: 0, y: 0, z: 0 },
      entryPosition: { x: 10, y: 0, z: 0 },
    });
    expect(calls).toEqual([
      [3, 0, 200],
      [3, 0, 300],
      [4, 0, 200],
      [4, 0, 300],
      [5, 0, 200],
      [5, 0, 300],
    ]);
    expect(result.observations[0]).not.toHaveProperty('travelTicks');
    expect(result.observations[0]).not.toHaveProperty('verifiedReturnRoute');
  });

  it('does not manufacture post-kill ordering from the kill tick', async () => {
    const input = fixture();
    input.frames[1].lines.find((line) => line.targetId === 'next')!.status = 'clear';
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('requires known frames continuously after the kill', async () => {
    const input = fixture();
    input.frames = input.frames.filter((frame) => frame.tick !== 1);
    const result = await collectPostKillCoverDepartures(input);
    expect(result.observations).toEqual([]);
    expect(result.reasons).toContain('post-kill-cover-frame-incomplete');
  });
  it('rejects a missing frame between entry and the hit', async () => {
    const input = fixture();
    input.frames = input.frames.filter((frame) => frame.tick !== 4);
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not turn a stationary enemy peek into the subject leaving cover', async () => {
    const input = fixture();
    input.frames[3].actors[0] = player('you', 0);
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not attribute the line to the subject when the old position is exposed too', async () => {
    const input = fixture();
    input.contexts.get(3)!.trace = () => Promise.resolve({ status: 'clear', reason: 'clear', rays: [] });
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not turn a jump, fall, step or unknown ground state into a choice to stay covered', async () => {
    for (const mode of ['airborne', 'height', 'unknown'] as const) {
      const input = fixture();
      if (mode === 'airborne') input.frames[3].actors[0].onGround = false;
      if (mode === 'height') input.frames[3].actors[0].position.z = 18;
      if (mode === 'unknown') input.frames[2].actors[0].onGround = null;
      expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
    }
  });
  it('checks retained cover throughout, not only the first entry frame', async () => {
    const input = fixture();
    input.contexts.get(4)!.trace = () => Promise.resolve({ status: 'clear', reason: 'clear', rays: [] });
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('checks every other enemy at the previous cover point too', async () => {
    const input = fixture();
    input.contexts.get(4)!.trace = (_from, to) =>
      Promise.resolve({
        status: to[0] === 300 ? 'clear' : 'blocked',
        reason: 'clear',
        rays: [],
      });
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('keeps uncertain smoke, dynamic geometry and unknown gunlines unknown', async () => {
    for (const mode of ['context', 'trace', 'line'] as const) {
      const input = fixture();
      if (mode === 'context') input.contexts.get(4)!.reason = 'active-smoke-bounds-unverified';
      if (mode === 'trace')
        input.contexts.get(4)!.trace = () =>
          Promise.resolve({ status: 'unknown', reason: 'dynamic-incomplete', rays: [] });
      if (mode === 'line') input.frames[4].lines.find((line) => line.targetId === 'other')!.status = 'unknown';
      const result = await collectPostKillCoverDepartures(input);
      expect(result.observations).toEqual([]);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
  it('does not call an unknown enemy absent', async () => {
    const input = fixture();
    input.frames[4].actors = input.frames[4].actors.filter((actor) => actor.id !== 'other');
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('requires continuity of the actual attacker gunline', async () => {
    const input = fixture();
    input.frames[4].lines.find((line) => line.targetId === 'next')!.status = 'blocked';
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not infer order when entry and damage share one tick', async () => {
    const input = fixture();
    input.events[1].tick = 3;
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not recommend retaining a position where prior utility or wallbang damage was observed', async () => {
    const input = fixture();
    input.events.push({
      id: 'earlier-hurt',
      kind: 'damage',
      actorId: 'other',
      targetId: 'you',
      tick: 2,
      amount: 5,
      weaponKind: 'grenade',
    });
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('requires an actual subsequent gun hit from a newly exposed enemy', async () => {
    for (const mode of ['utility', 'other', 'missing'] as const) {
      const input = fixture();
      if (mode === 'utility') input.events[1].weaponKind = 'grenade';
      if (mode === 'other') input.events[1].actorId = 'other';
      if (mode === 'missing') input.events.pop();
      expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
    }
  });
  it('does not carry a living state into an already dead snapshot at the hit tick', async () => {
    const input = fixture();
    input.frames[5].actors[0].alive = false;
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('does not attach a later fight after a different intervening kill', async () => {
    const input = fixture();
    input.events.push({
      id: 'later-kill',
      kind: 'kill',
      actorId: 'you',
      targetId: 'other',
      tick: 4,
      weaponKind: 'gun',
    });
    expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
  });
  it('rejects duplicate ticks, identities and event IDs', async () => {
    for (const mode of ['tick', 'identity', 'event'] as const) {
      const input = fixture();
      if (mode === 'tick') input.frames.push(input.frames[3]);
      if (mode === 'identity') input.frames[3].actors.push(input.frames[3].actors[0]);
      if (mode === 'event') input.events.push(input.events[1]);
      expect((await collectPostKillCoverDepartures(input)).observations).toEqual([]);
    }
  });
  it('supports cancellation before extra spatial traces', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collectPostKillCoverDepartures({ ...fixture(), signal: controller.signal })).rejects.toThrow();
  });
});
