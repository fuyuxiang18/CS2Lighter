import type { DeathRiskInput, DeathRiskReport } from 'csdm/common/types/death-risk';
import { DEATH_RISK_RULES } from 'csdm/common/death-review/death-risk-rules';

const ruleIds = new Set<string>(DEATH_RISK_RULES.map((rule) => rule.id));
const adviceCodes = new Set<string>(DEATH_RISK_RULES.map((rule) => rule.advice));
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}
function tick(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function vector(value: unknown) {
  return object(value) && ['x', 'y', 'z'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}
function array(value: unknown, maximum: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maximum;
}
function strings(value: unknown, maximum = 128) {
  return array(value, maximum) && value.every(text);
}
function uniqueStrings(value: unknown, maximum = 128): value is string[] {
  return strings(value, maximum) && new Set(value as string[]).size === (value as string[]).length;
}
function values(value: unknown) {
  return (
    object(value) &&
    Object.keys(value).length <= 64 &&
    Object.values(value).every(
      (item) =>
        item === null ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)) ||
        (typeof item === 'string' && item.length <= 1024),
    )
  );
}

/** Bad optional analysis never makes a previously readable trajectory disappear. */
export function isDeathRiskReport(value: unknown): value is DeathRiskReport {
  if (
    !object(value) ||
    value.version !== 1 ||
    !text(value.ruleRevision) ||
    !['evaluated', 'partial', 'unavailable'].includes(String(value.status)) ||
    !array(value.findings, 128) ||
    !strings(value.selectedFindingIds, 3) ||
    !array(value.evaluations, 14) ||
    value.evaluations.length !== 14
  )
    return false;
  const ids = new Set<string>();
  const findingRules = new Map<string, string>();
  for (const finding of value.findings) {
    if (
      !object(finding) ||
      !text(finding.id) ||
      ids.has(finding.id) ||
      !ruleIds.has(String(finding.ruleId)) ||
      !uniqueStrings(finding.relatedRuleIds, 14) ||
      !finding.relatedRuleIds.every((id) => ruleIds.has(id) && id !== finding.ruleId) ||
      !tick(finding.startTick) ||
      !tick(finding.endTick) ||
      finding.startTick > finding.endTick ||
      !finite(finding.priority) ||
      finding.priority < 0 ||
      finding.priority > 100 ||
      (finding.subtype !== undefined && !text(finding.subtype)) ||
      !uniqueStrings(finding.targetIds, 10) ||
      !array(finding.evidence, 256) ||
      finding.evidence.length === 0 ||
      !object(finding.advice) ||
      !adviceCodes.has(String(finding.advice.code)) ||
      !values(finding.advice.values)
    )
      return false;
    ids.add(finding.id);
    findingRules.set(finding.id, String(finding.ruleId));
    if (
      !finding.evidence.every(
        (item) =>
          object(item) &&
          text(item.code) &&
          tick(item.tick) &&
          (item.endTick === undefined || (tick(item.endTick) && item.endTick >= item.tick)) &&
          (item.actorId === undefined || text(item.actorId)) &&
          (item.targetId === undefined || text(item.targetId)) &&
          values(item.values) &&
          strings(item.sources, 256) &&
          (item.position === undefined || vector(item.position)),
      )
    )
      return false;
  }
  const selected = value.selectedFindingIds as string[];
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !ids.has(id)) ||
    (value.findings.length > 0 && selected.length === 0)
  )
    return false;
  const evaluated = new Set<string>();
  const referenced = new Set<string>();
  let unavailable = 0;
  for (const item of value.evaluations) {
    if (
      !object(item) ||
      !ruleIds.has(String(item.ruleId)) ||
      evaluated.has(String(item.ruleId)) ||
      !['matched', 'clear', 'unavailable', 'not-applicable'].includes(String(item.status)) ||
      !strings(item.reasons) ||
      !uniqueStrings(item.findingIds) ||
      item.findingIds.some((id) => findingRules.get(id) !== item.ruleId || referenced.has(id)) ||
      (item.status === 'matched') !== item.findingIds.length > 0
    )
      return false;
    item.findingIds.forEach((id) => referenced.add(id));
    if (item.status === 'unavailable') unavailable++;
    evaluated.add(String(item.ruleId));
  }
  return (
    referenced.size === ids.size &&
    value.status === (unavailable === 14 ? 'unavailable' : unavailable > 0 ? 'partial' : 'evaluated')
  );
}

/** Only bounded, typed facts can enter a rule-only recomputation from disk. */
export function isDeathRiskInput(value: unknown): value is DeathRiskInput {
  if (
    !object(value) ||
    value.version !== 1 ||
    !text(value.subjectId) ||
    (value.eligible !== undefined && typeof value.eligible !== 'boolean') ||
    !uniqueStrings(value.enemyIds, 5) ||
    !uniqueStrings(value.teammateIds, 4) ||
    new Set([value.subjectId, ...value.enemyIds, ...value.teammateIds]).size !==
      1 + value.enemyIds.length + value.teammateIds.length ||
    !tick(value.startTick) ||
    !tick(value.deathTick) ||
    value.startTick > value.deathTick ||
    !finite(value.tickrate) ||
    value.tickrate <= 0 ||
    value.tickrate > 1024 ||
    value.deathTick - value.startTick >= 4096 ||
    !array(value.frames, 4096) ||
    !array(value.shots, 4096) ||
    !array(value.events, 8192) ||
    !array(value.precision, 4096) ||
    !array(value.aim, 4096) ||
    !array(value.cover, 4096) ||
    !array(value.support, 4096) ||
    !array(value.interventions, 4096) ||
    !object(value.coverage)
  )
    return false;
  if (
    !['events', 'shots', 'weaponState', 'flash', 'precision', 'aim', 'repeekInterventions'].every(
      (key) => typeof (value.coverage as Record<string, unknown>)[key] === 'boolean',
    )
  )
    return false;
  const startTick = value.startTick;
  const deathTick = value.deathTick;
  let previous = -1;
  for (const frame of value.frames) {
    if (
      !object(frame) ||
      !tick(frame.tick) ||
      frame.tick <= previous ||
      frame.tick < value.startTick ||
      frame.tick > value.deathTick ||
      !array(frame.actors, 10) ||
      !array(frame.lines, 100)
    )
      return false;
    previous = frame.tick;
    const actorIds = new Set<string>();
    const lineIds = new Set<string>();
    for (const actor of frame.actors) {
      if (
        !object(actor) ||
        !text(actor.id) ||
        actorIds.has(actor.id) ||
        typeof actor.alive !== 'boolean' ||
        !vector(actor.position) ||
        !vector(actor.eye) ||
        !(actor.onGround === null || typeof actor.onGround === 'boolean') ||
        !(actor.yaw === null || (typeof actor.yaw === 'number' && Number.isFinite(actor.yaw)))
      )
        return false;
      actorIds.add(actor.id);
      if (actor.weapon !== null) {
        const weapon = actor.weapon;
        if (
          !object(weapon) ||
          !text(weapon.entityId) ||
          !text(weapon.name) ||
          !['gun', 'knife', 'grenade', 'bomb', 'other'].includes(String(weapon.kind)) ||
          !(weapon.magazine === null || (tick(weapon.magazine) && weapon.magazine <= 1000)) ||
          !(weapon.reloading === null || typeof weapon.reloading === 'boolean') ||
          !(weapon.ready === null || typeof weapon.ready === 'boolean') ||
          !(weapon.deploying === undefined || weapon.deploying === null || typeof weapon.deploying === 'boolean') ||
          !(weapon.nextReadyTick === undefined || weapon.nextReadyTick === null || tick(weapon.nextReadyTick))
        )
          return false;
      }
      if (
        actor.blind !== null &&
        (!object(actor.blind) ||
          !(actor.blind.sourceId === null || text(actor.blind.sourceId)) ||
          !tick(actor.blind.startTick) ||
          !tick(actor.blind.endTick) ||
          actor.blind.startTick > actor.blind.endTick)
      )
        return false;
    }
    for (const line of frame.lines) {
      if (
        !object(line) ||
        !text(line.observerId) ||
        !text(line.targetId) ||
        line.observerId === line.targetId ||
        !['clear', 'blocked', 'unknown'].includes(String(line.status)) ||
        (line.reason !== undefined && !text(line.reason))
      )
        return false;
      const key = `${line.observerId}:${line.targetId}`;
      if (lineIds.has(key)) return false;
      lineIds.add(key);
      const proof = line.previousObserverPosition;
      if (
        proof !== undefined &&
        (!object(proof) ||
          !tick(proof.tick) ||
          proof.tick >= frame.tick ||
          !text(proof.source) ||
          !['clear', 'blocked', 'unknown'].includes(String(proof.status)))
      )
        return false;
    }
  }
  if (
    !value.shots.every(
      (shot) =>
        object(shot) &&
        text(shot.id) &&
        tick(shot.tick) &&
        shot.tick >= startTick &&
        shot.tick <= deathTick &&
        text(shot.actorId) &&
        text(shot.weaponEntityId) &&
        text(shot.weaponName),
    )
  )
    return false;
  const shotIds = new Set(value.shots.map((shot) => (shot as Record<string, unknown>).id));
  if (shotIds.size !== value.shots.length) return false;
  if (
    !value.events.every(
      (event) =>
        object(event) &&
        text(event.id) &&
        tick(event.tick) &&
        event.tick >= startTick &&
        event.tick <= deathTick &&
        text(event.actorId) &&
        text(event.targetId) &&
        (event.kind === 'kill' ||
          (event.kind === 'damage' &&
            typeof event.amount === 'number' &&
            Number.isFinite(event.amount) &&
            event.amount > 0)) &&
        (event.weaponKind === undefined ||
          (typeof event.weaponKind === 'string' && ['gun', 'grenade', 'knife', 'other'].includes(event.weaponKind))),
    )
  )
    return false;
  if (new Set(value.events.map((event) => (event as Record<string, unknown>).id)).size !== value.events.length)
    return false;
  if (
    !value.precision.every(
      (sample) =>
        object(sample) &&
        text(sample.shotId) &&
        shotIds.has(sample.shotId) &&
        ['movement', 'landing', 'recovery'].includes(String(sample.kind)) &&
        text(sample.profileSource) &&
        typeof sample.profileVerified === 'boolean' &&
        typeof sample.componentVerified === 'boolean' &&
        typeof sample.segmentFirstShot === 'boolean' &&
        typeof sample.targetGeometryVerified === 'boolean' &&
        text(sample.targetId) &&
        (sample.targetAssociationVerified === undefined || typeof sample.targetAssociationVerified === 'boolean') &&
        ['baselineHalfAngleDegrees', 'actualHalfAngleDegrees', 'measurementResolutionDegrees', 'distance'].every(
          (key) => finite(sample[key]) && sample[key] >= 0,
        ) &&
        (sample.targetHalfAngleDegrees === null ||
          (finite(sample.targetHalfAngleDegrees) && sample.targetHalfAngleDegrees > 0)) &&
        (sample.stableAfterTick === null || tick(sample.stableAfterTick)) &&
        (sample.movementSpeed === undefined || (finite(sample.movementSpeed) && sample.movementSpeed >= 0)) &&
        (sample.landingTick === undefined || tick(sample.landingTick)) &&
        (sample.precedingShotTick === undefined || tick(sample.precedingShotTick)),
    )
  )
    return false;
  if (
    !value.aim.every(
      (sample) =>
        object(sample) &&
        text(sample.shotId) &&
        shotIds.has(sample.shotId) &&
        text(sample.targetId) &&
        text(sample.burstId) &&
        text(sample.source) &&
        typeof sample.verified === 'boolean' &&
        ['relativePitch', 'relativeYaw', 'bodyPitchMin', 'bodyPitchMax', 'bodyYawMin', 'bodyYawMax'].every((key) =>
          finite(sample[key]),
        ) &&
        tick(sample.maximumGapTicks) &&
        sample.maximumGapTicks > 0 &&
        sample.maximumGapTicks <= 4096 &&
        (sample.bodyPitchMin as number) < (sample.bodyPitchMax as number) &&
        (sample.bodyYawMin as number) < (sample.bodyYawMax as number),
    )
  )
    return false;
  if (
    !value.cover.every(
      (proof) =>
        object(proof) &&
        text(proof.actorId) &&
        tick(proof.tick) &&
        vector(proof.position) &&
        proof.tick >= startTick &&
        proof.tick <= deathTick &&
        typeof proof.verified === 'boolean' &&
        uniqueStrings(proof.enemyIds, 5) &&
        tick(proof.travelTicks) &&
        text(proof.source),
    )
  )
    return false;
  if (
    !value.support.every(
      (proof) =>
        object(proof) &&
        text(proof.teammateId) &&
        text(proof.targetId) &&
        tick(proof.startTick) &&
        tick(proof.endTick) &&
        proof.startTick <= proof.endTick &&
        typeof proof.verified === 'boolean' &&
        text(proof.source) &&
        (proof.earliestPossibleSupportTick === null || tick(proof.earliestPossibleSupportTick)) &&
        (proof.previousSupport === undefined ||
          (object(proof.previousSupport) &&
            tick(proof.previousSupport.tick) &&
            proof.previousSupport.tick < proof.startTick &&
            vector(proof.previousSupport.subjectPosition) &&
            text(proof.previousSupport.source))),
    )
  )
    return false;
  if (value.supportTransitions !== undefined) {
    const transitions = value.supportTransitions;
    if (!object(transitions) || !array(transitions.observations, 64) || !uniqueStrings(transitions.reasons))
      return false;
    const ids = new Set<string>();
    for (const item of transitions.observations) {
      if (
        !object(item) ||
        !text(item.id) ||
        ids.has(item.id) ||
        !text(item.targetId) ||
        !tick(item.startTick) ||
        !tick(item.endTick) ||
        item.startTick < startTick ||
        item.endTick > deathTick ||
        item.startTick > item.endTick ||
        !vector(item.entryPosition) ||
        !vector(item.positionBeforeEntry) ||
        !uniqueStrings(item.blockedTeammateIds, 4) ||
        !finite(item.displacementFromSharedPosition) ||
        item.displacementFromSharedPosition <= 0 ||
        !uniqueStrings(item.eventIds, 8192) ||
        item.eventIds.length === 0 ||
        !strings(item.sources, 32768) ||
        (item.sources as string[]).length === 0 ||
        !object(item.previousSupport) ||
        !tick(item.previousSupport.tick) ||
        item.previousSupport.tick < startTick ||
        item.previousSupport.tick >= item.startTick ||
        !text(item.previousSupport.targetId) ||
        !vector(item.previousSupport.subjectPosition) ||
        !uniqueStrings(item.previousSupport.teammateIds, 4) ||
        item.previousSupport.teammateIds.length === 0
      )
        return false;
      ids.add(item.id);
    }
  }
  return value.interventions.every(
    (item) =>
      object(item) &&
      tick(item.startTick) &&
      tick(item.endTick) &&
      item.startTick <= item.endTick &&
      text(item.enemyId) &&
      text(item.source),
  );
}
