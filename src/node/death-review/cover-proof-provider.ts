import type { DeathRiskPostKillCoverDeparture } from 'csdm/common/types/death-cover';
import type { DeathRiskEvent, DeathRiskFrame, DeathRiskVector } from 'csdm/common/types/death-risk';
import type { GunlineFrameContext } from './gunline-evidence';

type Input = {
  subjectId: string;
  enemyIds: string[];
  startTick: number;
  deathTick: number;
  frames: DeathRiskFrame[];
  events: DeathRiskEvent[];
  contexts: ReadonlyMap<number, GunlineFrameContext>;
  coverage: { events: boolean };
  signal?: AbortSignal;
};
type Result = { observations: DeathRiskPostKillCoverDeparture[]; reasons: string[] };

function finite(point: DeathRiskVector) {
  return [point.x, point.y, point.z].every(Number.isFinite);
}
function tuple(point: DeathRiskVector): readonly [number, number, number] {
  return [point.x, point.y, point.z];
}
function actor(frame: DeathRiskFrame, id: string) {
  return frame.actors.find((value) => value.id === id);
}
function line(frame: DeathRiskFrame, subjectId: string, enemyId: string) {
  const matches = frame.lines.filter((value) => value.observerId === subjectId && value.targetId === enemyId);
  return matches.length === 1 ? matches[0].status : 'unknown';
}

/**
 * Verify an actual post-kill departure from previously observed cover. The old
 * eye point must still be blocked from ALL live enemies in every current world
 * frame until a subsequent gun hit. This proves a lost line separation only;
 * it does not invent movement input, a traversable return path, or travel time.
 */
export async function collectPostKillCoverDepartures(input: Input): Promise<Result> {
  const observations: DeathRiskPostKillCoverDeparture[] = [];
  const reasons = new Set<string>();
  const finish = () => ({ observations, reasons: [...reasons].sort() });
  if (
    !Number.isSafeInteger(input.startTick) ||
    !Number.isSafeInteger(input.deathTick) ||
    input.startTick < 0 ||
    input.deathTick < input.startTick ||
    input.frames.length > 4096 ||
    input.enemyIds.length > 5 ||
    input.events.length > 16384 ||
    new Set([input.subjectId, ...input.enemyIds]).size !== input.enemyIds.length + 1
  )
    return { observations: [], reasons: ['invalid-cover-departure-input'] };
  if (!input.coverage.events) return { observations: [], reasons: ['cover-departure-events-incomplete'] };
  const frames = input.frames
    .filter((frame) => frame.tick >= input.startTick && frame.tick <= input.deathTick)
    .toSorted((a, b) => a.tick - b.tick);
  if (
    frames.some(
      (frame, index) => !Number.isSafeInteger(frame.tick) || (index > 0 && frame.tick === frames[index - 1].tick),
    ) ||
    new Set(input.events.map((event) => event.id)).size !== input.events.length
  )
    return { observations: [], reasons: ['ambiguous-cover-departure-evidence'] };
  const byTick = new Map(frames.map((frame) => [frame.tick, frame]));
  const known = (frame: DeathRiskFrame | undefined): frame is DeathRiskFrame => {
    if (!frame) return false;
    const context = input.contexts.get(frame.tick);
    if (!context || context.tick !== frame.tick || context.reason !== null || !context.source) return false;
    if (new Set(frame.actors.map((value) => value.id)).size !== frame.actors.length) return false;
    return [input.subjectId, ...input.enemyIds].every((id) => {
      const value = actor(frame, id);
      return value !== undefined && finite(value.position) && finite(value.eye);
    });
  };
  const living = (frame: DeathRiskFrame) => input.enemyIds.filter((id) => actor(frame, id)!.alive);
  const allCovered = (frame: DeathRiskFrame) =>
    living(frame).every((id) => line(frame, input.subjectId, id) === 'blocked');
  const unknownLine = (frame: DeathRiskFrame) =>
    living(frame).some((id) => line(frame, input.subjectId, id) === 'unknown');
  const kills = input.events
    .filter(
      (event) =>
        event.kind === 'kill' &&
        event.actorId === input.subjectId &&
        input.enemyIds.includes(event.targetId) &&
        Number.isSafeInteger(event.tick) &&
        event.tick >= input.startTick &&
        event.tick < input.deathTick,
    )
    .toSorted((a, b) => a.tick - b.tick);
  if (kills.length > 32) return { observations: [], reasons: ['invalid-cover-departure-input'] };

  for (let killIndex = 0; killIndex < kills.length; killIndex++) {
    input.signal?.throwIfAborted();
    const kill = kills[killIndex];
    const baseline = byTick.get(kill.tick + 1);
    if (!known(baseline)) {
      reasons.add('post-kill-cover-frame-incomplete');
      continue;
    }
    if (!actor(baseline, input.subjectId)!.alive || actor(baseline, kill.targetId)!.alive) continue;
    if (unknownLine(baseline)) {
      reasons.add('post-kill-gunlines-incomplete');
      continue;
    }
    if (!allCovered(baseline) || living(baseline).length === 0) continue;
    const endTick = Math.min(input.deathTick, (kills[killIndex + 1]?.tick ?? input.deathTick + 1) - 1);

    for (let tick = baseline.tick + 1; tick <= endTick; tick++) {
      input.signal?.throwIfAborted();
      const previous = byTick.get(tick - 1);
      const entry = byTick.get(tick);
      if (!known(previous) || !known(entry)) {
        reasons.add('post-kill-cover-frame-incomplete');
        break;
      }
      if (!actor(entry, input.subjectId)!.alive || actor(entry, kill.targetId)!.alive) break;
      if (unknownLine(entry)) {
        reasons.add('post-kill-gunlines-incomplete');
        break;
      }
      // Moving after being hit may be a response to danger in the old position.
      // Do not recommend staying there, including known wallbang/utility damage.
      if (
        input.events.some(
          (event) =>
            event.kind === 'damage' &&
            event.amount > 0 &&
            event.targetId === input.subjectId &&
            event.tick > kill.tick &&
            event.tick <= tick,
        )
      )
        break;
      if (allCovered(entry)) continue;
      const before = actor(previous, input.subjectId)!;
      const after = actor(entry, input.subjectId)!;
      const enteredEnemies = living(entry).filter((id) => line(entry, input.subjectId, id) === 'clear');
      // Falling/jumping or a change of level does not establish a choice to
      // retain the old point. This branch still makes no reverse-movement claim.
      if (before.onGround === null || after.onGround === null) {
        reasons.add('post-kill-ground-state-incomplete');
        break;
      }
      if (
        !allCovered(previous) ||
        enteredEnemies.length === 0 ||
        !before.onGround ||
        !after.onGround ||
        before.position.z !== after.position.z ||
        Math.hypot(
          after.position.x - before.position.x,
          after.position.y - before.position.y,
          after.position.z - before.position.z,
        ) === 0
      )
        break;
      const hits = input.events
        .filter(
          (event) =>
            event.kind === 'damage' &&
            event.amount > 0 &&
            event.weaponKind === 'gun' &&
            event.targetId === input.subjectId &&
            enteredEnemies.includes(event.actorId) &&
            Number.isSafeInteger(event.tick) &&
            event.tick > entry.tick &&
            event.tick <= endTick,
        )
        .toSorted((a, b) => a.tick - b.tick);
      const hit = hits[0];
      if (!hit) break;
      const sources = new Set([
        `event:${kill.id}`,
        `event:${hit.id}`,
        `frame:${baseline.tick}:${input.subjectId}`,
        `frame:${previous.tick}:${input.subjectId}`,
        `frame:${entry.tick}:${input.subjectId}`,
      ]);
      let verified = true;
      for (let currentTick = entry.tick; currentTick <= hit.tick; currentTick++) {
        input.signal?.throwIfAborted();
        const frame = byTick.get(currentTick);
        if (!known(frame)) {
          reasons.add('post-kill-cover-frame-incomplete');
          verified = false;
          break;
        }
        if (
          !actor(frame, input.subjectId)!.alive ||
          actor(frame, kill.targetId)!.alive ||
          !actor(frame, hit.actorId)!.alive ||
          unknownLine(frame) ||
          line(frame, input.subjectId, hit.actorId) !== 'clear'
        ) {
          if (unknownLine(frame)) reasons.add('post-kill-gunlines-incomplete');
          verified = false;
          break;
        }
        const context = input.contexts.get(currentTick)!;
        for (const enemyId of living(frame)) {
          const trace = await context.trace(tuple(before.eye), tuple(actor(frame, enemyId)!.eye));
          if (trace.status !== 'blocked') {
            if (trace.status === 'unknown') reasons.add('post-kill-retained-cover-unverified');
            verified = false;
            break;
          }
          sources.add(`${context.source}:retained-eye:${previous.tick}:enemy:${enemyId}`);
        }
        if (!verified) break;
      }
      if (verified) {
        observations.push({
          id: `post-kill-cover:${kill.id}:${entry.tick}:${hit.id}`,
          actorId: input.subjectId,
          killEventId: kill.id,
          killedEnemyId: kill.targetId,
          killTick: kill.tick,
          coverTick: previous.tick,
          entryTick: entry.tick,
          endTick: hit.tick,
          coverPosition: { ...before.position },
          coverEye: { ...before.eye },
          entryPosition: { ...after.position },
          enemyIds: enteredEnemies,
          hitEventId: hit.id,
          attackerId: hit.actorId,
          sources: [...sources],
        });
      }
      // Only the first contact after continuously witnessed cover belongs to
      // this kill. A later fight must not be attached to an unrelated old kill.
      break;
    }
  }
  return finish();
}
