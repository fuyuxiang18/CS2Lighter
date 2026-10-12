import { DEATH_RISK_REVISION, DEATH_RISK_RULES } from 'csdm/common/death-review/death-risk-rules';
import type {
  DeathRiskActorFrame,
  DeathRiskEvidence,
  DeathRiskFinding,
  DeathRiskFrame,
  DeathRiskInput,
  DeathRiskReport,
  DeathRiskRuleId,
  DeathRiskVector,
} from 'csdm/common/types/death-risk';

const EPSILON = 0.000001;
const MAX_FRAMES = 4096;
const MAX_FINDINGS = 128;

function distance(a: DeathRiskVector, b: DeathRiskVector) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function finite(...values: number[]) {
  return values.every(Number.isFinite);
}

function angle(origin: DeathRiskVector, a: DeathRiskVector, b: DeathRiskVector) {
  const first = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z };
  const second = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z };
  const denominator = Math.hypot(first.x, first.y, first.z) * Math.hypot(second.x, second.y, second.z);
  return denominator === 0
    ? 0
    : (Math.acos(
        Math.min(1, Math.max(-1, (first.x * second.x + first.y * second.y + first.z * second.z) / denominator)),
      ) *
        180) /
        Math.PI;
}

function actor(frame: DeathRiskFrame, id: string) {
  return frame.actors.find((value) => value.id === id);
}

function line(frame: DeathRiskFrame, observerId: string, targetId: string) {
  return frame.lines.find((value) => value.observerId === observerId && value.targetId === targetId);
}

function source(frame: DeathRiskFrame, id: string) {
  return `frame:${frame.tick}:${id}`;
}

function evidence(
  code: string,
  tick: number,
  values: DeathRiskEvidence['values'],
  sources: string[],
  extra: Partial<DeathRiskEvidence> = {},
): DeathRiskEvidence {
  return { code, tick, values, sources, ...extra };
}

/** Pure replay of verified facts. Unknown measurements are never coerced into negative evidence. */
export function buildDeathRiskReport(input: DeathRiskInput): DeathRiskReport {
  const report: DeathRiskReport = {
    version: 1,
    ruleRevision: DEATH_RISK_REVISION,
    status: 'unavailable',
    findings: [],
    selectedFindingIds: [],
    evaluations: DEATH_RISK_RULES.map(({ id }) => ({
      ruleId: id,
      status: 'unavailable',
      reasons: ['missing-evidence'],
      findingIds: [],
    })),
  };
  if (input.eligible === false) {
    report.status = 'evaluated';
    report.evaluations.forEach((value) => {
      value.status = 'not-applicable';
      value.reasons = ['unsupported-death-context'];
    });
    return report;
  }
  const evaluate = (ruleId: DeathRiskRuleId, available: boolean, applicable: boolean, reason: string) => {
    const entry = report.evaluations.find((value) => value.ruleId === ruleId)!;
    if (entry.status === 'matched') {
      return;
    }
    entry.status = available ? (applicable ? 'clear' : 'not-applicable') : 'unavailable';
    entry.reasons = available ? [] : [reason];
  };
  const add = (
    ruleId: DeathRiskRuleId,
    startTick: number,
    endTick: number,
    targetIds: string[],
    items: DeathRiskEvidence[],
    subtype?: string,
    priorityOverride?: number,
  ) => {
    if (
      report.findings.length >= MAX_FINDINGS ||
      report.findings.filter((value) => value.ruleId === ruleId).length >= 8
    ) {
      return;
    }
    const definition = DEATH_RISK_RULES.find((value) => value.id === ruleId)!;
    const id = `${ruleId}:${startTick}:${endTick}:${targetIds.join(',')}`;
    if (report.findings.some((value) => value.id === id)) {
      return;
    }
    report.findings.push({
      id,
      ruleId,
      relatedRuleIds: [],
      startTick,
      endTick,
      priority: priorityOverride ?? definition.priority,
      subtype,
      targetIds,
      evidence: items,
      advice: { code: definition.advice, values: items.at(-1)?.values ?? {} },
    });
    const entry = report.evaluations.find((value) => value.ruleId === ruleId)!;
    entry.status = 'matched';
    entry.reasons = [];
    entry.findingIds.push(id);
  };

  if (
    !finite(input.tickrate, input.startTick, input.deathTick) ||
    input.tickrate <= 0 ||
    input.deathTick < input.startTick ||
    input.frames.length > MAX_FRAMES ||
    input.enemyIds.length > 5 ||
    input.teammateIds.length > 4
  ) {
    report.evaluations.forEach((value) => (value.reasons = ['invalid-input']));
    return report;
  }

  const orderedFrames = input.frames.toSorted((a, b) => a.tick - b.tick);
  const duplicateTicks = new Set(
    orderedFrames.filter((value, index) => value.tick === orderedFrames[index - 1]?.tick).map((value) => value.tick),
  );
  const frames = orderedFrames.filter(
    (frame) =>
      Number.isInteger(frame.tick) &&
      frame.tick >= input.startTick &&
      frame.tick <= input.deathTick &&
      !duplicateTicks.has(frame.tick) &&
      new Set(frame.actors.map((value) => value.id)).size === frame.actors.length &&
      new Set(frame.lines.map((value) => `${value.observerId}:${value.targetId}`)).size === frame.lines.length &&
      frame.actors.every((value) =>
        finite(value.position.x, value.position.y, value.position.z, value.eye.x, value.eye.y, value.eye.z),
      ),
  );
  const shots = input.shots.filter(
    (shot) => shot.actorId === input.subjectId && shot.tick >= input.startTick && shot.tick <= input.deathTick,
  );
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const shotOrder = new Map(shots.toSorted((a, b) => a.tick - b.tick).map((shot, index) => [shot.id, index]));
  const events = input.events.filter(
    (event) => Number.isInteger(event.tick) && event.tick >= input.startTick && event.tick <= input.deathTick,
  );
  const enemies = new Set(input.enemyIds);
  const subject = (frame: DeathRiskFrame) => actor(frame, input.subjectId);
  const clearEnemies = (frame: DeathRiskFrame) =>
    input.enemyIds.filter((id) => actor(frame, id)?.alive && line(frame, input.subjectId, id)?.status === 'clear');
  const knownEnemyLines = (frame: DeathRiskFrame) =>
    input.enemyIds.every((id) => {
      const enemy = actor(frame, id);
      return (
        enemy && (!enemy.alive || ['clear', 'blocked'].includes(line(frame, input.subjectId, id)?.status ?? 'unknown'))
      );
    });
  const consecutive = (before: DeathRiskFrame | undefined, after: DeathRiskFrame) =>
    before && after.tick === before.tick + 1;
  const entered = (frame: DeathRiskFrame, previous: DeathRiskFrame | undefined, targetId: string) => {
    if (!consecutive(previous, frame) || !previous || !subject(frame)?.alive || !subject(previous)?.alive) {
      return false;
    }
    const proof = line(frame, input.subjectId, targetId);
    return (
      proof?.status === 'clear' &&
      line(previous, input.subjectId, targetId)?.status === 'blocked' &&
      proof.previousObserverPosition?.tick === previous.tick &&
      proof.previousObserverPosition.status === 'blocked' &&
      Boolean(proof.previousObserverPosition.source) &&
      distance(subject(frame)!.position, subject(previous)!.position) > EPSILON
    );
  };
  const completeFrames =
    frames.length > 0 &&
    frames[0].tick === input.startTick &&
    frames.at(-1)!.tick === input.deathTick &&
    frames.every((frame, index) => (index === 0 || consecutive(frames[index - 1], frame)) && subject(frame));
  const completeLines =
    completeFrames &&
    frames.every((frame) =>
      input.enemyIds.every((id) => {
        const target = actor(frame, id);
        return (
          target &&
          (!target.alive || ['clear', 'blocked'].includes(line(frame, input.subjectId, id)?.status ?? 'unknown'))
        );
      }),
    );
  const actualContact = (targetId: string, startTick: number, endTick: number) =>
    events.filter(
      (event) =>
        event.tick >= startTick &&
        event.tick <= endTick &&
        event.weaponKind === 'gun' &&
        ((event.actorId === input.subjectId && event.targetId === targetId) ||
          (event.targetId === input.subjectId && event.actorId === targetId)),
    );

  // R1-R3: the producer supplies version-verified component measurements, not speed heuristics.
  for (const [kind, ruleId] of [
    ['movement', 'r1'],
    ['landing', 'r2'],
    ['recovery', 'r3'],
  ] as const) {
    const candidates = input.precision.filter((sample) => sample.kind === kind);
    let allVerified = input.coverage.precision;
    for (const sample of candidates) {
      const shot = shotById.get(sample.shotId);
      const valid =
        shot &&
        sample.profileVerified &&
        sample.componentVerified &&
        Boolean(sample.profileSource) &&
        (sample.targetGeometryVerified || sample.targetAssociationVerified === true) &&
        enemies.has(sample.targetId) &&
        finite(
          sample.baselineHalfAngleDegrees,
          sample.actualHalfAngleDegrees,
          sample.measurementResolutionDegrees,
          sample.distance,
        ) &&
        sample.baselineHalfAngleDegrees >= 0 &&
        sample.measurementResolutionDegrees >= 0 &&
        sample.actualHalfAngleDegrees >= sample.baselineHalfAngleDegrees &&
        sample.actualHalfAngleDegrees < 90 &&
        (sample.targetHalfAngleDegrees === null ||
          (Number.isFinite(sample.targetHalfAngleDegrees) && sample.targetHalfAngleDegrees > 0)) &&
        sample.distance > 0;
      if (!valid || !shot) {
        allVerified = false;
        continue;
      }
      if (
        (kind !== 'landing' && !sample.segmentFirstShot) ||
        (kind === 'landing' && (sample.landingTick === undefined || sample.landingTick > shot.tick))
      ) {
        continue;
      }
      if (kind === 'recovery' && (sample.precedingShotTick === undefined || sample.precedingShotTick >= shot.tick)) {
        continue;
      }
      // The named component must be independently established above decoded measurement resolution.
      // Target geometry, when available, gives scale; it is not needed to claim a measured loss of precision.
      if (
        sample.actualHalfAngleDegrees >
          sample.baselineHalfAngleDegrees + Math.max(EPSILON, sample.measurementResolutionDegrees) &&
        (sample.stableAfterTick === null || sample.stableAfterTick > shot.tick)
      ) {
        add(
          ruleId,
          shot.tick,
          shot.tick,
          [sample.targetId],
          [
            evidence(
              'precision-at-shot',
              shot.tick,
              {
                weapon: shot.weaponName,
                kind,
                distance: sample.distance,
                baselineDegrees: sample.baselineHalfAngleDegrees,
                actualDegrees: sample.actualHalfAngleDegrees,
                baselineRadiusUnits: sample.distance * Math.tan((sample.baselineHalfAngleDegrees * Math.PI) / 180),
                actualRadiusUnits: sample.distance * Math.tan((sample.actualHalfAngleDegrees * Math.PI) / 180),
                targetDegrees: sample.targetHalfAngleDegrees,
                stableAfterTick: sample.stableAfterTick,
                movementSpeed: sample.movementSpeed ?? null,
                landingTick: sample.landingTick ?? null,
                precedingShotTick: sample.precedingShotTick ?? null,
              },
              [`shot:${shot.id}`, sample.profileSource],
              { targetId: sample.targetId },
            ),
          ],
          undefined,
          sample.targetGeometryVerified &&
            sample.targetHalfAngleDegrees !== null &&
            sample.baselineHalfAngleDegrees <= sample.targetHalfAngleDegrees &&
            sample.actualHalfAngleDegrees > sample.targetHalfAngleDegrees
            ? undefined
            : 60,
        );
      }
    }
    evaluate(ruleId, allVerified, shots.length > 0, 'weapon-precision-unverified');
  }

  // R4 uses target-relative aim, so camera tracking and changing world angles cannot trigger it.
  const aimGroups = new Map<string, typeof input.aim>();
  let aimComplete = input.coverage.aim;
  for (const sample of input.aim) {
    const shot = shotById.get(sample.shotId);
    if (
      !shot ||
      !sample.verified ||
      !sample.source ||
      !enemies.has(sample.targetId) ||
      !finite(
        sample.relativePitch,
        sample.relativeYaw,
        sample.bodyPitchMin,
        sample.bodyPitchMax,
        sample.bodyYawMin,
        sample.bodyYawMax,
        sample.maximumGapTicks,
      ) ||
      sample.bodyPitchMax <= sample.bodyPitchMin ||
      sample.bodyYawMax <= sample.bodyYawMin ||
      sample.maximumGapTicks < 1
    ) {
      aimComplete = false;
      continue;
    }
    const key = `${sample.burstId}:${sample.targetId}:${shot.weaponEntityId}`;
    const group = aimGroups.get(key) ?? [];
    group.push(sample);
    aimGroups.set(key, group);
  }
  for (const group of aimGroups.values()) {
    group.sort((a, b) => shotById.get(a.shotId)!.tick - shotById.get(b.shotId)!.tick);
    const segments: (typeof group)[] = [];
    for (const sample of group) {
      const segment = segments.at(-1);
      const previous = segment?.at(-1);
      const gap = previous ? shotById.get(sample.shotId)!.tick - shotById.get(previous.shotId)!.tick : 0;
      if (
        !previous ||
        gap <= 0 ||
        gap > Math.min(previous.maximumGapTicks, sample.maximumGapTicks) ||
        shotOrder.get(sample.shotId)! !== shotOrder.get(previous.shotId)! + 1
      ) {
        segments.push([sample]);
      } else {
        segment!.push(sample);
      }
    }
    for (const segment of segments) {
      const inside = (sample: (typeof segment)[number]) =>
        sample.relativePitch >= sample.bodyPitchMin &&
        sample.relativePitch <= sample.bodyPitchMax &&
        sample.relativeYaw >= sample.bodyYawMin &&
        sample.relativeYaw <= sample.bodyYawMax;
      if (segment.length < 4 || !segment.slice(0, 2).some(inside)) {
        continue;
      }
      let sideRun = 0;
      let lastSide = '';
      let horizontalReversals = 0;
      let lastHorizontal = 0;
      let firstHorizontalOutside = 0;
      for (let index = 1; index < segment.length; index++) {
        const sample = segment[index];
        const side =
          sample.relativePitch < sample.bodyPitchMin
            ? 'above'
            : sample.relativePitch > sample.bodyPitchMax
              ? 'below'
              : '';
        sideRun = side && side === lastSide ? sideRun + 1 : side ? 1 : 0;
        lastSide = side;
        const horizontal = sample.relativeYaw < sample.bodyYawMin ? -1 : sample.relativeYaw > sample.bodyYawMax ? 1 : 0;
        if (horizontal !== 0) {
          if (firstHorizontalOutside === 0) firstHorizontalOutside = index + 1;
          if (lastHorizontal !== 0 && horizontal !== lastHorizontal) horizontalReversals++;
          lastHorizontal = horizontal;
        }
        if (sideRun >= 3 || horizontalReversals >= 3) {
          const first = shotById.get(segment[0].shotId)!;
          const last = shotById.get(sample.shotId)!;
          add(
            'r4',
            first.tick,
            last.tick,
            [sample.targetId],
            [
              evidence(
                'target-relative-spray',
                first.tick,
                {
                  shotCount: index + 1,
                  firstOutsideShot: sideRun >= 3 ? index - sideRun + 2 : firstHorizontalOutside,
                  direction: sideRun >= 3 ? side : 'lateral',
                  reversals: horizontalReversals,
                  weapon: first.weaponName,
                },
                segment.slice(0, index + 1).flatMap((point) => [`shot:${point.shotId}`, point.source]),
                { endTick: last.tick, targetId: sample.targetId },
              ),
            ],
            sideRun >= 3 ? side : 'lateral',
          );
          break;
        }
      }
    }
  }
  evaluate('r4', aimComplete, shots.length > 0, 'target-relative-aim-unverified');

  // R5 follows stable enemy sets across contiguous decoded ticks; a missing frame ends the episode.
  const exposures: { startIndex: number; endIndex: number; targetIds: string[]; minimumAngle: number }[] = [];
  const active = new Map<string, (typeof exposures)[number]>();
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const player = subject(frame);
    const visible = clearEnemies(frame);
    const current = new Set<string>();
    if (player?.alive) {
      for (let mask = 0; mask < 1 << visible.length; mask++) {
        const selected = visible.filter((_, bit) => mask & (1 << bit)).sort();
        if (selected.length < 2) continue;
        let minimumAngle = 180;
        for (let a = 0; a < selected.length; a++) {
          for (let b = a + 1; b < selected.length; b++) {
            minimumAngle = Math.min(
              minimumAngle,
              angle(player.eye, actor(frame, selected[a])!.eye, actor(frame, selected[b])!.eye),
            );
          }
        }
        if (selected.length === 2 && minimumAngle < 30) continue;
        const key = selected.join(',');
        current.add(key);
        const existing = active.get(key);
        if (existing && consecutive(frames[existing.endIndex], frame)) {
          existing.endIndex = index;
          existing.minimumAngle = Math.min(existing.minimumAngle, minimumAngle);
        } else {
          if (existing) exposures.push(existing);
          active.set(key, { startIndex: index, endIndex: index, targetIds: selected, minimumAngle });
        }
      }
    }
    for (const [key, value] of active) {
      if (!current.has(key)) {
        exposures.push(value);
        active.delete(key);
      }
    }
  }
  exposures.push(...active.values());
  const significantExposures = exposures.filter(
    (value) => (frames[value.endIndex].tick - frames[value.startIndex].tick) / input.tickrate >= 0.2,
  );
  for (const exposure of significantExposures) {
    if (
      significantExposures.some(
        (other) =>
          other !== exposure &&
          other.startIndex <= exposure.startIndex &&
          other.endIndex >= exposure.endIndex &&
          other.targetIds.length > exposure.targetIds.length &&
          exposure.targetIds.every((id) => other.targetIds.includes(id)),
      )
    )
      continue;
    const first = frames[exposure.startIndex];
    const last = frames[exposure.endIndex];
    add('r5', first.tick, last.tick, exposure.targetIds, [
      evidence(
        'multiple-gunlines',
        first.tick,
        {
          enemyCount: exposure.targetIds.length,
          minimumAngle: exposure.minimumAngle,
          durationSeconds: (last.tick - first.tick) / input.tickrate,
        },
        exposure.targetIds.map((id) => `gunline:${first.tick}:${input.subjectId}:${id}`),
        { endTick: last.tick, position: subject(first)!.position },
      ),
    ]);
  }
  evaluate('r5', completeLines, input.enemyIds.length > 1, 'gunline-coverage-incomplete');

  let counterfactualComplete = completeLines;
  for (let index = 1; index < frames.length; index++) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const player = subject(frame);
    if (!player?.alive || !consecutive(previous, frame)) continue;
    const before = subject(previous);
    if (!before?.alive) continue;
    const currentEnemies = clearEnemies(frame);
    const newlyEntered = currentEnemies.filter((id) => entered(frame, previous, id));
    if (distance(player.position, before.position) > EPSILON) {
      for (const id of currentEnemies) {
        if (
          line(previous, input.subjectId, id)?.status === 'blocked' &&
          !line(frame, input.subjectId, id)?.previousObserverPosition
        )
          counterfactualComplete = false;
      }
    }
    const associatedExposure = significantExposures.find(
      (value) =>
        value.startIndex <= index && value.endIndex >= index && newlyEntered.some((id) => value.targetIds.includes(id)),
    );
    if (
      associatedExposure &&
      newlyEntered.length > 0 &&
      knownEnemyLines(previous) &&
      knownEnemyLines(frame) &&
      currentEnemies.length > clearEnemies(previous).length
    ) {
      add('r6', previous.tick, frames[associatedExposure.endIndex].tick, associatedExposure.targetIds, [
        evidence(
          'self-created-gunline',
          frame.tick,
          {
            beforeEnemyCount: clearEnemies(previous).length,
            afterEnemyCount: currentEnemies.length,
            movementUnits: distance(player.position, before.position),
          },
          newlyEntered.map((id) => line(frame, input.subjectId, id)!.previousObserverPosition!.source),
          { position: player.position },
        ),
        evidence(
          'earlier-position',
          previous.tick,
          { enemyCount: clearEnemies(previous).length },
          [source(previous, input.subjectId)],
          { position: before.position },
        ),
      ]);
    }

    // R9-R13 require an actual incoming hit while the relevant handicap and the gunline overlap.
    for (const targetId of currentEnemies) {
      const selfEntry = newlyEntered.includes(targetId);
      const reloadStarted =
        player.weapon?.reloading === true &&
        before.weapon?.reloading === false &&
        player.weapon.entityId === before.weapon.entityId;
      const predicates: [DeathRiskRuleId, (state: DeathRiskActorFrame) => boolean][] = [
        [
          'r9',
          (state) =>
            Boolean(
              state.weapon &&
              (['knife', 'grenade', 'bomb'].includes(state.weapon.kind) ||
                (state.weapon.deploying === true && state.weapon.ready === false)),
            ),
        ],
        ['r10', (state) => state.weapon?.reloading === true],
        [
          'r11',
          (state) => state.weapon?.kind === 'gun' && state.weapon.magazine === 0 && state.weapon.reloading === false,
        ],
        [
          'r12',
          (state) =>
            Boolean(
              state.blind &&
              state.blind.sourceId === input.subjectId &&
              state.blind.startTick <= frame.tick &&
              state.blind.endTick >= frame.tick,
            ),
        ],
        [
          'r13',
          (state) =>
            Boolean(
              state.blind &&
              state.blind.sourceId !== input.subjectId &&
              state.blind.startTick <= frame.tick &&
              state.blind.endTick >= frame.tick,
            ),
        ],
      ];
      for (const [ruleId, predicate] of predicates) {
        const stableEntry =
          selfEntry &&
          predicate(before) &&
          !shots.some((shot) => shot.tick >= previous.tick && shot.tick <= frame.tick);
        const exposedReloadStart =
          ruleId === 'r10' && reloadStarted && line(previous, input.subjectId, targetId)?.status === 'clear';
        if ((!stableEntry && !exposedReloadStart) || !predicate(player)) continue;
        if (ruleId === 'r11' && before.weapon?.entityId !== player.weapon?.entityId) continue;
        if (!input.coverage.events || (['r12', 'r13'].includes(ruleId) && !input.coverage.flash)) continue;
        const window: DeathRiskFrame[] = [];
        for (let cursor = index; cursor < frames.length; cursor++) {
          const candidate = frames[cursor];
          const state = subject(candidate);
          if (
            (cursor > index && !consecutive(frames[cursor - 1], candidate)) ||
            !state ||
            !predicate(state) ||
            line(candidate, input.subjectId, targetId)?.status !== 'clear'
          )
            break;
          if (
            ['r12', 'r13'].includes(ruleId) &&
            (!state.blind || state.blind.endTick < candidate.tick || state.blind.startTick > candidate.tick)
          )
            break;
          window.push(candidate);
        }
        const hit = events.find(
          (event) =>
            event.kind === 'damage' &&
            event.weaponKind === 'gun' &&
            event.amount > 0 &&
            event.actorId === targetId &&
            event.targetId === input.subjectId &&
            event.tick >= frame.tick &&
            (!exposedReloadStart || event.tick > frame.tick) &&
            event.tick <= window.at(-1)!.tick,
        );
        if (!hit || hit.kind !== 'damage') continue;
        add(
          ruleId,
          frame.tick,
          hit.tick,
          [targetId],
          [
            evidence(
              selfEntry ? 'self-created-gunline' : 'reload-started-exposed',
              frame.tick,
              {
                weapon: player.weapon?.name ?? '',
                magazine: player.weapon?.magazine ?? null,
                ready: player.weapon?.ready ?? null,
                blindSource: player.blind?.sourceId
                  ? player.blind.sourceId === input.subjectId
                    ? 'self'
                    : 'other'
                  : null,
                blindEndTick: player.blind?.endTick ?? null,
              },
              [
                source(frame, input.subjectId),
                ...(selfEntry ? [line(frame, input.subjectId, targetId)!.previousObserverPosition!.source] : []),
              ],
              { targetId, position: player.position },
            ),
            evidence(
              'earlier-position',
              previous.tick,
              { enemyCount: clearEnemies(previous).length },
              [source(previous, input.subjectId)],
              { position: before.position },
            ),
            evidence('incoming-hit', hit.tick, { damage: hit.amount }, [`event:${hit.id}`], { targetId }),
          ],
          ruleId === 'r12' ? 'self-flash' : ruleId === 'r13' ? 'other-flash' : player.weapon?.kind,
        );
      }
    }
  }
  evaluate('r6', counterfactualComplete, input.enemyIds.length > 1, 'self-movement-proof-missing');
  for (const ruleId of ['r9', 'r10', 'r11'] as const)
    evaluate(
      ruleId,
      counterfactualComplete && input.coverage.events && input.coverage.weaponState,
      true,
      'weapon-or-entry-proof-missing',
    );
  for (const ruleId of ['r12', 'r13'] as const)
    evaluate(
      ruleId,
      counterfactualComplete && input.coverage.events && input.coverage.flash,
      true,
      'blindness-or-entry-proof-missing',
    );

  // R7 is clear -> contacted -> blocked -> self-created clear, not merely dying twice near an angle.
  for (const targetId of input.enemyIds) {
    let firstContact: DeathRiskFrame | undefined;
    let hadCover = false;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      const state = line(frame, input.subjectId, targetId)?.status;
      if (!subject(frame)?.alive || !actor(frame, targetId)?.alive) {
        firstContact = undefined;
        hadCover = false;
        continue;
      }
      if (index > 0 && !consecutive(frames[index - 1], frame)) {
        firstContact = undefined;
        hadCover = false;
      }
      if (state === 'unknown' || !state) {
        firstContact = undefined;
        hadCover = false;
        continue;
      }
      if (firstContact && state === 'blocked') hadCover = true;
      if (firstContact && hadCover && entered(frame, frames[index - 1], targetId)) {
        const player = subject(frame)!;
        const originalPlayer = subject(firstContact)!;
        const target = actor(frame, targetId);
        const originalTarget = actor(firstContact, targetId);
        const intervened = input.interventions.some(
          (value) => value.enemyId === targetId && value.endTick >= firstContact!.tick && value.startTick <= frame.tick,
        );
        let contactEndTick = frame.tick;
        for (let cursor = index; cursor < frames.length; cursor++) {
          const candidate = frames[cursor];
          if (
            (cursor > index && !consecutive(frames[cursor - 1], candidate)) ||
            !subject(candidate)?.alive ||
            !actor(candidate, targetId)?.alive ||
            line(candidate, input.subjectId, targetId)?.status !== 'clear'
          )
            break;
          contactEndTick = candidate.tick;
        }
        if (
          input.coverage.repeekInterventions &&
          input.coverage.events &&
          target?.alive &&
          target.weapon?.kind === 'gun' &&
          target.weapon.ready === true &&
          target.weapon.magazine !== null &&
          target.weapon.magazine > 0 &&
          !target.blind &&
          originalTarget &&
          distance(player.position, originalPlayer.position) <= 32 &&
          distance(target.position, originalTarget.position) <= 32 &&
          !intervened &&
          actualContact(targetId, frame.tick, contactEndTick).length > 0
        ) {
          add(
            'r7',
            firstContact.tick,
            frame.tick,
            [targetId],
            [
              evidence(
                'previous-exchange',
                firstContact.tick,
                {},
                actualContact(targetId, firstContact.tick, firstContact.tick).map((event) => `event:${event.id}`),
                { targetId, position: originalPlayer.position },
              ),
              evidence(
                'same-line-reentry',
                frame.tick,
                { previousContactTick: firstContact.tick, enemyReady: true },
                [line(frame, input.subjectId, targetId)!.previousObserverPosition!.source, source(frame, targetId)],
                { targetId, position: player.position },
              ),
            ],
          );
        }
        firstContact = undefined;
        hadCover = false;
      }
      if (state === 'clear' && actualContact(targetId, frame.tick, frame.tick).length > 0) firstContact = frame;
    }
  }
  evaluate(
    'r7',
    counterfactualComplete && input.coverage.events && input.coverage.repeekInterventions && input.coverage.weaponState,
    true,
    'repeek-context-incomplete',
  );

  // R8 requires a currently verified escape, not a guessed nearby wall or an arbitrary post-kill timer.
  const kills = events.filter(
    (event) => event.kind === 'kill' && event.actorId === input.subjectId && enemies.has(event.targetId),
  );
  for (const kill of kills) {
    for (const frame of frames) {
      if (frame.tick <= kill.tick) continue;
      if (!subject(frame)?.alive) continue;
      const targets = clearEnemies(frame).filter((id) => id !== kill.targetId);
      if (targets.length === 0) continue;
      const cover = input.cover.find(
        (value) =>
          value.actorId === input.subjectId &&
          value.tick === frame.tick &&
          value.verified &&
          value.source &&
          value.travelTicks >= 0 &&
          value.tick + value.travelTicks < input.deathTick &&
          targets.every((id) => value.enemyIds.includes(id)),
      );
      if (!cover) continue;
      const hit = events.find(
        (event) =>
          event.kind === 'damage' &&
          event.weaponKind === 'gun' &&
          event.amount > 0 &&
          event.targetId === input.subjectId &&
          targets.includes(event.actorId) &&
          event.tick > frame.tick + cover.travelTicks,
      );
      if (!hit) continue;
      const untilHit = frames.filter((value) => value.tick >= frame.tick && value.tick <= hit.tick);
      if (
        untilHit.length !== hit.tick - frame.tick + 1 ||
        untilHit.some((value) => line(value, input.subjectId, hit.actorId)?.status !== 'clear')
      )
        continue;
      add(
        'r8',
        kill.tick,
        hit.tick,
        [hit.actorId],
        [
          evidence('kill-before-exposure', kill.tick, {}, [`event:${kill.id}`], { targetId: kill.targetId }),
          evidence(
            'reachable-cover',
            frame.tick,
            { travelSeconds: cover.travelTicks / input.tickrate, hitTick: hit.tick },
            [cover.source, `event:${hit.id}`],
            { targetId: hit.actorId, position: cover.position },
          ),
        ],
      );
      break;
    }
  }
  evaluate(
    'r8',
    input.coverage.events && completeLines && (kills.length === 0 || input.cover.some((value) => value.verified)),
    kills.length > 0,
    'escape-route-unverified',
  );

  // R14: previously shared gunline -> own entry -> no actual teammate gunline in this fight.
  // No assumption is made about all possible routes or hypothetical arrival times.
  const transitions = input.supportTransitions;
  let transitionEvidenceValid = true;
  const gunReady = (player: DeathRiskActorFrame | undefined) =>
    Boolean(
      player?.alive &&
      !player.blind &&
      player.weapon?.kind === 'gun' &&
      player.weapon.ready === true &&
      player.weapon.magazine !== null &&
      player.weapon.magazine > 0,
    );
  for (const observation of transitions?.observations ?? []) {
    const index = frames.findIndex((frame) => frame.tick === observation.startTick);
    const first = frames[index];
    const prior = frames.find((frame) => frame.tick === observation.previousSupport.tick);
    const window = frames.filter((frame) => frame.tick >= observation.startTick && frame.tick <= observation.endTick);
    const continuous = frames.filter(
      (frame) => frame.tick >= observation.previousSupport.tick && frame.tick <= observation.endTick,
    );
    const last = window.at(-1);
    const next = frames[index + window.length];
    const validWindow =
      last &&
      last.tick === observation.endTick &&
      window.length === observation.endTick - observation.startTick + 1 &&
      continuous.length === observation.endTick - observation.previousSupport.tick + 1 &&
      (last.tick === input.deathTick ||
        (next?.tick === last.tick + 1 &&
          (line(next, input.subjectId, observation.targetId)?.status === 'blocked' ||
            actor(next, observation.targetId)?.alive === false)));
    const contact = actualContact(observation.targetId, observation.startTick, observation.endTick);
    const samePosition = (left: DeathRiskVector | undefined, right: DeathRiskVector) =>
      left !== undefined && distance(left, right) <= EPSILON;
    if (
      !first ||
      !prior ||
      !validWindow ||
      !input.coverage.events ||
      !input.coverage.flash ||
      !enemies.has(observation.targetId) ||
      !enemies.has(observation.previousSupport.targetId) ||
      !entered(first, frames[index - 1], observation.targetId) ||
      !gunReady(subject(prior)) ||
      line(prior, input.subjectId, observation.previousSupport.targetId)?.status !== 'clear' ||
      !actor(prior, observation.previousSupport.targetId)?.alive ||
      contact.length === 0 ||
      !contact.some((event) => observation.eventIds.includes(event.id)) ||
      observation.sources.length === 0 ||
      !samePosition(subject(prior)?.position, observation.previousSupport.subjectPosition) ||
      !samePosition(subject(first)?.position, observation.entryPosition) ||
      !samePosition(subject(frames[index - 1])?.position, observation.positionBeforeEntry) ||
      observation.previousSupport.teammateIds.length === 0 ||
      !observation.previousSupport.teammateIds.every(
        (id) =>
          input.teammateIds.includes(id) &&
          gunReady(actor(prior, id)) &&
          line(prior, id, observation.previousSupport.targetId)?.status === 'clear',
      ) ||
      observation.previousSupport.tick >= observation.startTick
    ) {
      transitionEvidenceValid = false;
      continue;
    }
    const teammates = input.teammateIds.filter((id) => actor(first, id)?.alive);
    if (
      teammates.length === 0 ||
      input.teammateIds.some((id) => !actor(first, id)) ||
      !teammates.every((id) => observation.blockedTeammateIds.includes(id)) ||
      observation.blockedTeammateIds.some((id) => !teammates.includes(id)) ||
      window.some(
        (frame) =>
          line(frame, input.subjectId, observation.targetId)?.status !== 'clear' ||
          input.teammateIds.some(
            (id) =>
              !actor(frame, id) ||
              (actor(frame, id)!.alive && line(frame, id, observation.targetId)?.status !== 'blocked'),
          ),
      )
    ) {
      transitionEvidenceValid = false;
      continue;
    }
    const movement = distance(observation.previousSupport.subjectPosition, observation.entryPosition);
    if (
      movement <= EPSILON ||
      !finite(observation.displacementFromSharedPosition) ||
      Math.abs(movement - observation.displacementFromSharedPosition) > EPSILON
    ) {
      transitionEvidenceValid = false;
      continue;
    }
    add(
      'r14',
      prior.tick,
      last!.tick,
      [observation.targetId],
      [
        evidence(
          'shared-support-position',
          prior.tick,
          {
            teammateCount: observation.previousSupport.teammateIds.length,
            previousTargetId: observation.previousSupport.targetId,
          },
          observation.previousSupport.teammateIds.map(
            (id) => `gunline:${prior.tick}:${id}:${observation.previousSupport.targetId}`,
          ),
          { targetId: observation.previousSupport.targetId, position: observation.previousSupport.subjectPosition },
        ),
        evidence(
          'self-created-gunline',
          first.tick,
          { movementUnits: movement },
          [line(first, input.subjectId, observation.targetId)!.previousObserverPosition!.source],
          { targetId: observation.targetId, position: observation.entryPosition },
        ),
        evidence(
          'unsupported-contact',
          first.tick,
          { teammateCount: teammates.length, durationSeconds: (last!.tick - first.tick) / input.tickrate },
          [...observation.sources.slice(0, 32), ...contact.map((event) => `event:${event.id}`)],
          { endTick: last!.tick, targetId: observation.targetId },
        ),
      ],
      'lost-shared-gunline',
    );
  }
  evaluate(
    'r14',
    transitions !== undefined &&
      transitionEvidenceValid &&
      transitions.reasons.length === 0 &&
      counterfactualComplete &&
      input.coverage.events &&
      input.coverage.flash &&
      input.coverage.weaponState,
    input.teammateIds.length > 0,
    'support-transition-unverified',
  );
  // Hide observations already explained by a more concrete action; keep evaluations and full evidence.
  const overlaps = (a: DeathRiskFinding, b: DeathRiskFinding) =>
    a.startTick <= b.endTick && b.startTick <= a.endTick && a.targetIds.some((id) => b.targetIds.includes(id));
  const ranked = report.findings.toSorted(
    (a, b) => b.priority - a.priority || b.endTick - a.endTick || a.id.localeCompare(b.id),
  );
  const selected: DeathRiskFinding[] = [];
  for (const finding of ranked) {
    const same = selected.find(
      (value) =>
        value.ruleId === finding.ruleId ||
        (['r12', 'r13'].includes(value.ruleId) && ['r12', 'r13'].includes(finding.ruleId)),
    );
    const explained = selected.find(
      (value) =>
        overlaps(value, finding) &&
        ((finding.ruleId === 'r5' && ['r6', 'r8'].includes(value.ruleId)) ||
          (value.ruleId === 'r6' && finding.ruleId === 'r8') ||
          (['r9', 'r10', 'r11'].includes(value.ruleId) && ['r9', 'r10', 'r11'].includes(finding.ruleId)) ||
          (['r12', 'r13'].includes(value.ruleId) && ['r12', 'r13'].includes(finding.ruleId))),
    );
    if (same || explained) {
      const primary = same ?? explained!;
      if (primary.ruleId !== finding.ruleId && !primary.relatedRuleIds.includes(finding.ruleId))
        primary.relatedRuleIds.push(finding.ruleId);
      continue;
    }
    if (selected.length < 3) selected.push(finding);
  }
  report.selectedFindingIds = selected.map((value) => value.id);
  const unavailable = report.evaluations.filter((value) => value.status === 'unavailable').length;
  report.status = unavailable === report.evaluations.length ? 'unavailable' : unavailable > 0 ? 'partial' : 'evaluated';
  return report;
}
