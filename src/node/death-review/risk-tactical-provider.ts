import { WeaponName, WeaponType } from 'csdm/common/types/counter-strike';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import type {
  DeathRiskActorFrame,
  DeathRiskEvent,
  DeathRiskInput,
  DeathRiskVector,
} from 'csdm/common/types/death-risk';
import type { DamageRow } from 'csdm/node/database/damages/damage-table';
import type { KillRow } from 'csdm/node/database/kills/kill-table';
import type { ShotRow } from 'csdm/node/database/shots/shot-table';
import type { PlayerBlindRow } from 'csdm/node/database/player-blinds/player-blind-table';
import { evidenceNumber, type EvidenceFrame, type EvidenceVector } from './evidence-protocol';
import type { GunlineFrameContext } from './gunline-evidence';
import { decodeRiskWeaponState } from './weapon-accuracy';

type Input = {
  record: DeathReviewRecord;
  startTick: number;
  frames: EvidenceFrame[];
  contexts: Map<number, GunlineFrameContext>;
  gunlines: DeathEvidenceReport['gunlines'];
  damages: DamageRow[];
  kills: KillRow[];
  shots: ShotRow[];
  blinds: PlayerBlindRow[];
  shotsComplete: boolean;
  signal: AbortSignal;
};
const gunTypes: Set<WeaponType> = new Set([
  WeaponType.Pistol,
  WeaponType.SMG,
  WeaponType.Shotgun,
  WeaponType.Rifle,
  WeaponType.Sniper,
  WeaponType.MachineGun,
]);
function weaponKind(type: WeaponType): DeathRiskEvent['weaponKind'] {
  return gunTypes.has(type)
    ? 'gun'
    : type === WeaponType.Grenade
      ? 'grenade'
      : type === WeaponType.Melee
        ? 'knife'
        : 'other';
}
function vector(value: EvidenceVector | null): DeathRiskVector | null {
  return value?.length === 3 && value.every(Number.isFinite) ? { x: value[0], y: value[1], z: value[2] } : null;
}
function tuple(value: DeathRiskVector): EvidenceVector {
  return [value.x, value.y, value.z];
}

/** Adapts observed frames, never carries a pre-death state forward into the death frame. */
export async function buildRiskTacticalEvidence(input: Input): Promise<DeathRiskInput> {
  const { record, startTick, signal } = input;
  const inWindow = (event: { round_number: number; tick: number }) =>
    event.round_number === record.roundNumber && event.tick >= startTick && event.tick <= record.eventTick;
  const observedTeams = new Map<string, Set<number>>();
  for (const frame of input.frames) {
    for (const player of frame.players) {
      if (!player.steamId || !/^\d{17}$/.test(player.steamId) || ![2, 3].includes(player.team ?? 0)) continue;
      const teams = observedTeams.get(player.steamId) ?? new Set<number>();
      teams.add(player.team!);
      observedTeams.set(player.steamId, teams);
    }
  }
  const subjectTeams = observedTeams.get(record.steamId);
  const subjectTeam = subjectTeams?.size === 1 ? [...subjectTeams][0] : null;
  const enemyIds: string[] = [],
    teammateIds: string[] = [];
  for (const [id, teams] of observedTeams) {
    if (teams.size !== 1 || id === record.steamId || subjectTeam === null) continue;
    (teams.has(subjectTeam) ? teammateIds : enemyIds).push(id);
  }
  const rosterValid =
    enemyIds.length === 5 && teammateIds.length === 4 && [...observedTeams.values()].every((teams) => teams.size === 1);
  const result: DeathRiskInput = {
    version: 1,
    eligible: record.kind === 'enemy' && record.evaluatedRules.length > 0 && rosterValid,
    subjectId: record.steamId,
    enemyIds: enemyIds.slice(0, 5),
    teammateIds: teammateIds.slice(0, 4),
    startTick,
    deathTick: record.eventTick,
    tickrate: record.tickrate,
    frames: [],
    shots: [],
    events: [],
    precision: [],
    aim: [],
    cover: [],
    support: [],
    interventions: [],
    coverage: {
      events: true,
      shots: input.shotsComplete,
      weaponState: false,
      flash: true,
      precision: false,
      aim: false,
      repeekInterventions: false,
    },
  };
  for (const event of input.damages.filter(inWindow)) {
    if (
      event.is_attacker_controlling_bot ||
      event.is_victim_controlling_bot ||
      !Number.isFinite(event.health_damage) ||
      event.health_damage <= 0
    )
      continue;
    result.events.push({
      id: `damage:${event.id}`,
      kind: 'damage',
      tick: event.tick,
      actorId: event.attacker_steam_id,
      targetId: event.victim_steam_id,
      amount: Math.min(event.health_damage, event.victim_health),
      weaponKind: weaponKind(event.weapon_type),
    });
  }
  for (const event of input.kills.filter(inWindow)) {
    if (event.is_killer_controlling_bot || event.is_victim_controlling_bot) continue;
    result.events.push({
      id: `kill:${event.id}`,
      kind: 'kill',
      tick: event.tick,
      actorId: event.killer_steam_id,
      targetId: event.victim_steam_id,
      weaponKind: weaponKind(event.weapon_type),
    });
  }
  result.events.sort((a, b) => a.tick - b.tick);
  const firearmNames = new Set<WeaponName>([
    WeaponName.AK47,
    WeaponName.AUG,
    WeaponName.AWP,
    WeaponName.CZ75,
    WeaponName.Deagle,
    WeaponName.DualBerettas,
    WeaponName.Famas,
    WeaponName.FiveSeven,
    WeaponName.G3SG1,
    WeaponName.GalilAR,
    WeaponName.Glock,
    WeaponName.M249,
    WeaponName.M4A1,
    WeaponName.M4A4,
    WeaponName.Mac10,
    WeaponName.MAG7,
    WeaponName.MP5,
    WeaponName.MP7,
    WeaponName.MP9,
    WeaponName.Negev,
    WeaponName.Nova,
    WeaponName.P2000,
    WeaponName.P250,
    WeaponName.P90,
    WeaponName.PPBizon,
    WeaponName.Revolver,
    WeaponName.SawedOff,
    WeaponName.Scar20,
    WeaponName.Scout,
    WeaponName.SG553,
    WeaponName.Tec9,
    WeaponName.UMP45,
    WeaponName.USP,
    WeaponName.XM1014,
  ]);
  result.shots = input.shots
    .filter((shot) => inWindow(shot) && !shot.is_player_controlling_bot && firearmNames.has(shot.weapon_name))
    .map((shot) => ({
      id: `shot-event:${shot.id}`,
      tick: shot.tick,
      actorId: shot.player_steam_id,
      weaponEntityId: shot.weapon_id,
      weaponName: shot.weapon_name,
    }));
  const blinds = input.blinds.filter(
    (event) =>
      event.round_number === record.roundNumber &&
      event.tick <= record.eventTick &&
      event.tick + event.duration * record.tickrate >= startTick &&
      !event.is_flashed_controlling_bot &&
      !event.is_flasher_controlling_bot &&
      Number.isFinite(event.duration) &&
      event.duration > 0,
  );
  const linesByTick = new Map<number, DeathEvidenceReport['gunlines']>();
  for (const line of input.gunlines) {
    const lines = linesByTick.get(line.tick) ?? [];
    lines.push(line);
    linesByTick.set(line.tick, lines);
  }
  const contactTargets = new Set(
    result.events
      .filter((event) => event.weaponKind === 'gun')
      .flatMap((event) =>
        event.actorId === record.steamId ? [event.targetId] : event.targetId === record.steamId ? [event.actorId] : [],
      )
      .filter((id) => enemyIds.includes(id)),
  );
  let interventionCoverage = input.shotsComplete;
  for (const raw of input.frames) {
    signal.throwIfAborted();
    if (raw.tick < startTick || raw.tick > record.eventTick) continue;
    const actors: DeathRiskActorFrame[] = [];
    for (const player of raw.players) {
      const position = vector(player.origin),
        eye = vector(player.eyes);
      if (
        !player.steamId ||
        !observedTeams.has(player.steamId) ||
        !position ||
        !eye ||
        player.health === null ||
        player.lifeState === null
      )
        continue;
      const flags = evidenceNumber(player.fields.m_fFlags);
      const intervals = blinds
        .filter(
          (event) =>
            event.flashed_steam_id === player.steamId &&
            event.tick <= raw.tick &&
            raw.tick < event.tick + event.duration * record.tickrate,
        )
        .toSorted((a, b) => b.tick + b.duration * record.tickrate - a.tick - a.duration * record.tickrate);
      const blind = intervals[0];
      const sources = new Set(intervals.map((event) => event.flasher_steam_id));
      if (sources.size > 1) result.coverage.flash = false;
      actors.push({
        id: player.steamId,
        alive: player.lifeState === 0 && player.health > 0,
        position,
        eye,
        yaw: player.yaw,
        weapon: decodeRiskWeaponState(player, raw, record.tickrate),
        onGround: flags !== null && Number.isInteger(flags) ? (flags & 1) !== 0 : null,
        blind: blind
          ? {
              sourceId: sources.size === 1 ? blind.flasher_steam_id : null,
              startTick: blind.tick,
              endTick: Math.ceil(blind.tick + blind.duration * record.tickrate) - 1,
            }
          : null,
      });
    }
    const frame: DeathRiskInput['frames'][number] = {
      tick: raw.tick,
      actors,
      lines: (linesByTick.get(raw.tick) ?? []).map((line) => ({
        observerId: record.steamId,
        targetId: line.enemySteamId,
        status: line.status,
        reason: line.reason,
      })),
    };
    const previous = result.frames.at(-1);
    const context = input.contexts.get(raw.tick);
    const subject = actors.find((actor) => actor.id === record.steamId);
    const before = previous?.actors.find((actor) => actor.id === record.steamId);
    if (context && previous && previous.tick + 1 === frame.tick && subject?.alive && before?.alive) {
      for (const line of frame.lines) {
        const target = actors.find((actor) => actor.id === line.targetId);
        if (
          line.status !== 'clear' ||
          !target?.alive ||
          previous.lines.find(
            (candidate) => candidate.observerId === record.steamId && candidate.targetId === line.targetId,
          )?.status !== 'blocked'
        )
          continue;
        const trace = await context.trace(tuple(before.eye), tuple(target.eye));
        line.previousObserverPosition = {
          tick: previous.tick,
          status: trace.status,
          source: `${context.source}:previous-eye:${previous.tick}:${line.targetId}`,
        };
      }
    }
    for (const targetId of contactTargets) {
      const target = actors.find((actor) => actor.id === targetId);
      if (!target?.alive) continue;
      for (const teammateId of teammateIds) {
        const teammate = actors.find((actor) => actor.id === teammateId);
        if (!teammate) {
          interventionCoverage = false;
          continue;
        }
        if (!teammate.alive) continue;
        const trace = context ? await context.trace(tuple(teammate.eye), tuple(target.eye)) : null;
        frame.lines.push({
          observerId: teammateId,
          targetId,
          status: trace?.status ?? 'unknown',
          reason: trace?.reason ?? 'map-unavailable',
        });
        if (!trace || trace.status === 'unknown') interventionCoverage = false;
        // A usable friendly line changes the encounter even if the teammate has not fired yet.
        if (trace?.status === 'clear')
          result.interventions.push({
            startTick: raw.tick,
            endTick: raw.tick,
            enemyId: targetId,
            source: `${context!.source}:teammate:${teammateId}`,
          });
      }
    }
    result.frames.push(frame);
  }
  // Any friendly shot or the subject's own utility conservatively changes a re-peek sequence.
  for (const shot of input.shots.filter(inWindow)) {
    const ownUtility =
      shot.player_steam_id === record.steamId &&
      (
        [
          WeaponName.Flashbang,
          WeaponName.HEGrenade,
          WeaponName.Smoke,
          WeaponName.Molotov,
          WeaponName.Incendiary,
          WeaponName.Decoy,
        ] as WeaponName[]
      ).includes(shot.weapon_name);
    if ((!teammateIds.includes(shot.player_steam_id) && !ownUtility) || shot.is_player_controlling_bot) continue;
    for (const enemyId of contactTargets)
      result.interventions.push({ startTick: shot.tick, endTick: shot.tick, enemyId, source: `shot-event:${shot.id}` });
  }
  for (const blind of blinds) {
    if (!contactTargets.has(blind.flashed_steam_id)) continue;
    result.interventions.push({
      startTick: Math.max(startTick, blind.tick),
      endTick: Math.min(record.eventTick, Math.ceil(blind.tick + blind.duration * record.tickrate)),
      enemyId: blind.flashed_steam_id,
      source: `blind-event:${blind.id}`,
    });
  }
  for (const event of result.events) {
    if (!contactTargets.has(event.targetId) || (event.actorId === record.steamId && event.weaponKind === 'gun'))
      continue;
    result.interventions.push({
      startTick: event.tick,
      endTick: event.tick,
      enemyId: event.targetId,
      source: `event:${event.id}`,
    });
  }
  // Collapse adjacent observations without losing the covered interval or claiming an unobserved tick.
  result.interventions.sort((a, b) => a.enemyId.localeCompare(b.enemyId) || a.startTick - b.startTick);
  const merged: DeathRiskInput['interventions'] = [];
  for (const item of result.interventions) {
    const previous = merged.at(-1);
    if (previous && previous.enemyId === item.enemyId && item.startTick <= previous.endTick + 1) {
      previous.endTick = Math.max(previous.endTick, item.endTick);
    } else merged.push({ ...item });
  }
  result.interventions = merged;
  result.coverage.repeekInterventions = interventionCoverage;
  result.coverage.weaponState =
    result.frames.length > 0 &&
    result.frames.every((frame) =>
      frame.actors
        .filter((actor) => actor.alive)
        .every(
          (actor) =>
            actor.weapon !== null &&
            (actor.weapon.kind !== 'gun' ||
              (actor.weapon.magazine !== null && actor.weapon.reloading !== null && actor.weapon.ready !== null)),
        ),
    );
  return result;
}
