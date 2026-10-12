import type {
  DeathRiskActorFrame,
  DeathRiskEvent,
  DeathRiskFrame,
  DeathRiskVector,
  DeathRiskSupportTransition,
} from 'csdm/common/types/death-risk';
import type { GunlineFrameContext } from './gunline-evidence';

type Context = Pick<GunlineFrameContext, 'tick' | 'source' | 'reason'>;
type Input = {
  subjectId: string;
  enemyIds: string[];
  teammateIds: string[];
  startTick: number;
  deathTick: number;
  frames: DeathRiskFrame[];
  contexts: ReadonlyMap<number, Context>;
  events: DeathRiskEvent[];
  coverage: { events: boolean; flash: boolean; weaponState: boolean };
};

type Result = { observations: DeathRiskSupportTransition[]; reasons: string[] };

function actor(frame: DeathRiskFrame, id: string) {
  return frame.actors.find((value) => value.id === id);
}

function status(frame: DeathRiskFrame, observerId: string, targetId: string) {
  return frame.lines.find((value) => value.observerId === observerId && value.targetId === targetId);
}

function gunReady(player: DeathRiskActorFrame | undefined): boolean {
  return Boolean(
    player?.alive &&
    !player.blind &&
    player.weapon?.kind === 'gun' &&
    player.weapon.ready === true &&
    player.weapon.magazine !== null &&
    player.weapon.magazine > 0,
  );
}

function distance(a: DeathRiskVector, b: DeathRiskVector) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Collect a narrow, replayable formation change: a witnessed shared gunline,
 * followed by a self-created contact while all living teammates' actual lines
 * to that opponent are blocked. A previous and current opponent may differ and
 * are retained explicitly. No movement speed, nav path, or inability to switch
 * weapons is inferred. Callers must not coerce these observations into the
 * stronger DeathRiskSupportProof used by all-route R14 checks.
 */
export function collectSupportTransitions(input: Input): Result {
  const result: Result = { observations: [], reasons: [] };
  const reasons = new Set<string>();
  if (
    !Number.isSafeInteger(input.startTick) ||
    !Number.isSafeInteger(input.deathTick) ||
    input.startTick < 0 ||
    input.deathTick < input.startTick ||
    input.frames.length > 4096 ||
    input.teammateIds.length > 4 ||
    input.enemyIds.length > 5 ||
    new Set([...input.teammateIds, ...input.enemyIds, input.subjectId]).size !==
      input.teammateIds.length + input.enemyIds.length + 1
  )
    return { observations: [], reasons: ['invalid-spatial-input'] };
  if (!input.coverage.events || !input.coverage.flash || !input.coverage.weaponState)
    return { observations: [], reasons: ['support-transition-coverage-incomplete'] };
  if (input.teammateIds.length === 0) return result;

  const frames = input.frames
    .filter((frame) => frame.tick >= input.startTick && frame.tick <= input.deathTick)
    .toSorted((a, b) => a.tick - b.tick);
  if (
    frames.some(
      (frame, index) => !Number.isSafeInteger(frame.tick) || (index > 0 && frame.tick === frames[index - 1].tick),
    )
  )
    return { observations: [], reasons: ['duplicate-spatial-tick'] };
  const knownFrame = (frame: DeathRiskFrame) => {
    const context = input.contexts.get(frame.tick);
    return (
      context?.tick === frame.tick &&
      context.reason === null &&
      Boolean(context.source) &&
      frame.actors.every((player) =>
        [player.position.x, player.position.y, player.position.z].every(Number.isFinite),
      ) &&
      new Set(frame.actors.map((player) => player.id)).size === frame.actors.length &&
      [...input.enemyIds, ...input.teammateIds, input.subjectId].every((id) => actor(frame, id))
    );
  };

  for (let index = 1; index < frames.length && result.observations.length < 64; index++) {
    const first = frames[index];
    const previous = frames[index - 1];
    if (first.tick !== previous.tick + 1 || !knownFrame(first) || !knownFrame(previous)) continue;
    const subject = actor(first, input.subjectId)!;
    const before = actor(previous, input.subjectId)!;
    if (!subject.alive || !before.alive || distance(subject.position, before.position) === 0) continue;
    for (const targetId of input.enemyIds) {
      const line = status(first, input.subjectId, targetId);
      if (
        !actor(first, targetId)?.alive ||
        line?.status !== 'clear' ||
        status(previous, input.subjectId, targetId)?.status !== 'blocked' ||
        line.previousObserverPosition?.tick !== previous.tick ||
        line.previousObserverPosition.status !== 'blocked' ||
        !line.previousObserverPosition.source
      )
        continue;

      const window: DeathRiskFrame[] = [];
      let closed = false;
      let incomplete = false;
      for (let cursor = index; cursor < frames.length; cursor++) {
        const frame = frames[cursor];
        if ((cursor > index && frame.tick !== frames[cursor - 1].tick + 1) || !knownFrame(frame)) {
          incomplete = true;
          break;
        }
        if (status(frame, input.subjectId, targetId)?.status === 'blocked' || !actor(frame, targetId)!.alive) {
          closed = true;
          break;
        }
        if (status(frame, input.subjectId, targetId)?.status !== 'clear') {
          incomplete = true;
          break;
        }
        window.push(frame);
        if (frame.tick === input.deathTick) {
          closed = true;
          break;
        }
      }
      if (incomplete || !closed || window.length === 0) {
        reasons.add('support-contact-window-incomplete');
        continue;
      }
      const last = window.at(-1)!;
      const events = input.events.filter(
        (event) =>
          event.tick >= first.tick &&
          event.tick <= last.tick &&
          event.weaponKind === 'gun' &&
          (event.kind === 'kill' || event.amount > 0) &&
          ((event.actorId === input.subjectId && event.targetId === targetId) ||
            (event.actorId === targetId && event.targetId === input.subjectId)),
      );
      if (events.length === 0) continue;
      const teammates = input.teammateIds.filter((id) => actor(first, id)!.alive);
      if (teammates.length === 0) continue;
      let noDirectSupport = true;
      for (const frame of window) {
        for (const teammateId of teammates) {
          if (!actor(frame, teammateId)!.alive) continue;
          const teammateLine = status(frame, teammateId, targetId)?.status;
          // Busy, empty, or flashed does not prove a lack of all possible assistance.
          // A clear line is therefore enough to suppress this narrower observation.
          if (teammateLine !== 'blocked') {
            if (teammateLine !== 'clear') reasons.add('teammate-gunline-unknown');
            noDirectSupport = false;
          }
        }
      }
      if (!noDirectSupport) continue;

      let prior: DeathRiskSupportTransition['previousSupport'] | null = null;
      for (let cursor = index - 1; cursor >= 0; cursor--) {
        const frame = frames[cursor];
        if (frames[cursor + 1].tick !== frame.tick + 1 || !knownFrame(frame)) break;
        if (!gunReady(actor(frame, input.subjectId))) continue;
        for (const priorTarget of input.enemyIds) {
          if (!actor(frame, priorTarget)!.alive || status(frame, input.subjectId, priorTarget)?.status !== 'clear')
            continue;
          const supporters = teammates.filter(
            (id) => gunReady(actor(frame, id)) && status(frame, id, priorTarget)?.status === 'clear',
          );
          if (
            supporters.length === 0 &&
            teammates.some(
              (id) =>
                gunReady(actor(frame, id)) &&
                !['clear', 'blocked'].includes(status(frame, id, priorTarget)?.status ?? 'unknown'),
            )
          )
            reasons.add('earlier-support-gunline-unknown');
          if (supporters.length === 0 || distance(actor(frame, input.subjectId)!.position, subject.position) === 0)
            continue;
          prior = {
            tick: frame.tick,
            targetId: priorTarget,
            subjectPosition: { ...actor(frame, input.subjectId)!.position },
            teammateIds: supporters,
          };
          break;
        }
        if (prior) break;
      }
      if (!prior) continue;
      const id = `support-transition:${prior.tick}:${first.tick}:${last.tick}:${targetId}`;
      if (result.observations.some((observation) => observation.id === id)) continue;
      result.observations.push({
        id,
        targetId,
        startTick: first.tick,
        endTick: last.tick,
        entryPosition: { ...subject.position },
        positionBeforeEntry: { ...before.position },
        previousSupport: prior,
        blockedTeammateIds: teammates,
        displacementFromSharedPosition: distance(prior.subjectPosition, subject.position),
        eventIds: events.map((event) => event.id),
        sources: [
          line.previousObserverPosition.source,
          input.contexts.get(prior.tick)!.source,
          ...window.map((frame) => input.contexts.get(frame.tick)!.source),
          ...prior.teammateIds.map((id) => `gunline:${prior.tick}:${id}:${prior!.targetId}`),
          ...window.flatMap((frame) =>
            teammates.filter((id) => actor(frame, id)!.alive).map((id) => `gunline:${frame.tick}:${id}:${targetId}`),
          ),
        ],
      });
    }
  }
  result.reasons = [...reasons].sort();
  return result;
}
