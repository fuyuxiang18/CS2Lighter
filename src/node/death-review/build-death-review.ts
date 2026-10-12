import { DEATH_REVIEW_LIMITS as L, DEATH_RULES } from 'csdm/common/death-review/death-rules';
import { TeamNumber, WeaponName, WeaponType, type DemoSource } from 'csdm/common/types/counter-strike';
import type {
  DeathFinding,
  DeathKind,
  DeathMeasure,
  DeathReviewRecord,
  DeathSignal,
  DeathTimelineEvent,
} from 'csdm/common/types/death-review';
import type { BombDefuseStartRow } from 'csdm/node/database/bomb-defuse-start/bomb-defuse-start-table';
import type { BombPlantedRow } from 'csdm/node/database/bomb-planted/bomb-planted-table';
import type { DamageRow } from 'csdm/node/database/damages/damage-table';
import type { KillRow } from 'csdm/node/database/kills/kill-table';
import type { PlayerBlindRow } from 'csdm/node/database/player-blinds/player-blind-table';
import type { PlayerPositionRow } from 'csdm/node/database/player-position/player-position-table';
import type { RoundRow } from 'csdm/node/database/rounds/round-table';
import type { ShotRow } from 'csdm/node/database/shots/shot-table';

export type DeathMatchInput = {
  checksum: string;
  steamId: string;
  mapName: string;
  date: string;
  source: DemoSource;
  tickrate: number;
  tacticalEligible: boolean;
  /** Complete imported shot count must agree with the parser's match shot count. */
  shotsComplete: boolean;
  rounds: RoundRow[];
  kills: KillRow[];
  damages: DamageRow[];
  shots: ShotRow[];
  blinds: PlayerBlindRow[];
  /** Raw snapshots only. Interpolated or repeated synthetic ticks are not observations. */
  positions: PlayerPositionRow[];
  plants: BombPlantedRow[];
  defuses: BombDefuseStartRow[];
  roundPlayers?: { round_number: number; steam_id: string; side: TeamNumber }[];
};

const definitions = new Map(DEATH_RULES.map((rule) => [rule.code, rule]));
const grenades = new Set<WeaponName>([
  WeaponName.Flashbang,
  WeaponName.Smoke,
  WeaponName.HEGrenade,
  WeaponName.Molotov,
  WeaponName.Incendiary,
  WeaponName.Decoy,
]);
const automaticWeapons = new Set<WeaponName>([
  WeaponName.AK47,
  WeaponName.AUG,
  WeaponName.Famas,
  WeaponName.GalilAR,
  WeaponName.M4A1,
  WeaponName.M4A4,
  WeaponName.SG553,
  WeaponName.Mac10,
  WeaponName.MP5,
  WeaponName.MP7,
  WeaponName.MP9,
  WeaponName.P90,
  WeaponName.PPBizon,
  WeaponName.UMP45,
  WeaponName.M249,
  WeaponName.Negev,
  WeaponName.CZ75,
]);
const firearms = new Set<WeaponName>([
  ...automaticWeapons,
  WeaponName.AWP,
  WeaponName.G3SG1,
  WeaponName.Scar20,
  WeaponName.Scout,
  WeaponName.Deagle,
  WeaponName.DualBerettas,
  WeaponName.FiveSeven,
  WeaponName.Glock,
  WeaponName.P2000,
  WeaponName.P250,
  WeaponName.Revolver,
  WeaponName.Tec9,
  WeaponName.USP,
  WeaponName.MAG7,
  WeaponName.Nova,
  WeaponName.SawedOff,
  WeaponName.XM1014,
]);
type Event = { tick: number; frame: number; round_number: number; match_checksum: string };
function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}
function combatSide(side: TeamNumber): side is typeof TeamNumber.T | typeof TeamNumber.CT {
  return side === TeamNumber.T || side === TeamNumber.CT;
}
function order(a: { tick: number; frame: number }, b: { tick: number; frame: number }): number {
  return a.tick - b.tick || a.frame - b.frame;
}
function gun(weapon: WeaponName): boolean {
  return firearms.has(weapon);
}
function actualDamage(damage: DamageRow): number {
  return finite(damage.health_damage, damage.victim_health)
    ? Math.max(0, Math.min(damage.health_damage, damage.victim_health))
    : 0;
}
function angularDifference(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}
function deathKind(death: KillRow): DeathKind {
  if (!death.killer_steam_id || death.killer_steam_id === '0') {
    return death.weapon_type === WeaponType.World || death.weapon_name === WeaponName.World ? 'world' : 'unknown';
  }
  if (death.killer_steam_id === death.victim_steam_id) return 'self';
  if (!combatSide(death.killer_side) || !combatSide(death.victim_side)) return 'unknown';
  return death.killer_side === death.victim_side ? 'team' : 'enemy';
}
function measure(key: string, value: number, unit: DeathMeasure['unit']): DeathMeasure {
  return { key, value: Math.round(value * 100) / 100, unit };
}

/** Deterministic, multi-label observations. No causality, aim score, or AI output is produced. */
export function buildDeathReviews(input: DeathMatchInput): DeathReviewRecord[] {
  const records: DeathReviewRecord[] = [];
  const eventOrdinals = new Map<string, number>();
  for (const death of input.kills) {
    if (death.match_checksum !== input.checksum || death.victim_steam_id !== input.steamId) continue;
    const eventKey = `${input.checksum}:${input.steamId}:${death.round_number}:${death.tick}:${death.frame}`;
    const ordinal = eventOrdinals.get(eventKey) ?? 0;
    eventOrdinals.set(eventKey, ordinal + 1);
    const recordId = `${eventKey}:${ordinal}`;
    const round = input.rounds.find(
      (row) => row.match_checksum === input.checksum && row.number === death.round_number,
    );
    if (
      !round ||
      !finite(input.tickrate, death.tick, death.frame, round.start_tick, round.freeze_time_end_tick, round.end_tick) ||
      !Number.isSafeInteger(death.tick) ||
      input.tickrate <= 0
    ) {
      const tick = finite(death.tick) ? death.tick : 0;
      records.push({
        id: recordId,
        checksum: input.checksum,
        steamId: input.steamId,
        mapName: input.mapName,
        date: input.date,
        source: input.source,
        roundNumber: death.round_number,
        side: combatSide(death.victim_side) ? death.victim_side : null,
        eventTick: tick,
        startTick: tick,
        endTick: tick,
        tickrate: finite(input.tickrate) && input.tickrate > 0 ? input.tickrate : 0,
        kind: deathKind(death),
        killerSteamId: death.killer_steam_id || null,
        killerName: death.killer_name || null,
        weapon: death.weapon_name,
        roundWon: null,
        distance: null,
        range: null,
        healthBeforeHit: null,
        teammatesAlive: null,
        enemiesAlive: null,
        findings: [],
        evaluatedRules: [],
        missingSignals: [],
        timeline: [],
        recordingRequest: null,
      });
      continue;
    }
    const liveStart = Math.max(round.start_tick, round.freeze_time_end_tick);
    const withinRound = <T extends Event>(events: T[]): T[] =>
      events
        .filter(
          (event) =>
            event.match_checksum === input.checksum &&
            event.round_number === round.number &&
            finite(event.tick, event.frame),
        )
        .sort(order);
    const kills = withinRound(input.kills);
    const damages = withinRound(input.damages);
    const shots = withinRound(input.shots);
    const blinds = withinRound(input.blinds);
    const positions = withinRound(input.positions);
    const plants = withinRound(input.plants);
    const defuses = withinRound(input.defuses);
    const beforeDeath = (event: Event, seconds: number): boolean =>
      event.tick >= Math.max(liveStart, death.tick - seconds * input.tickrate) && order(event, death) <= 0;
    const previous = (event: Event, seconds: number): boolean => beforeDeath(event, seconds) && order(event, death) < 0;
    const live = (event: Event): boolean => event.tick >= liveStart && event.tick <= round.end_tick;
    const kind = deathKind(death);
    const side = combatSide(death.victim_side) ? death.victim_side : null;
    const taken = damages.filter(
      (event) =>
        event.victim_steam_id === input.steamId &&
        !event.is_victim_controlling_bot &&
        beforeDeath(event, L.contextSeconds) &&
        actualDamage(event) > 0,
    );
    const enemyTaken = taken.filter(
      (event) =>
        event.attacker_steam_id !== input.steamId &&
        !event.is_attacker_controlling_bot &&
        combatSide(event.attacker_side) &&
        event.attacker_side !== side,
    );
    const dealt = damages.filter(
      (event) =>
        event.attacker_steam_id === input.steamId &&
        !event.is_attacker_controlling_bot &&
        !event.is_victim_controlling_bot &&
        beforeDeath(event, L.exchangeSeconds) &&
        event.victim_side !== side &&
        combatSide(event.victim_side) &&
        actualDamage(event) > 0,
    );
    const ownShots = shots.filter(
      (event) =>
        event.player_steam_id === input.steamId &&
        !event.is_player_controlling_bot &&
        beforeDeath(event, L.shotWindowSeconds),
    );
    const gunShots = ownShots.filter((event) => gun(event.weapon_name));
    const finalShot = gunShots.at(-1);
    const fatalDamage = taken.findLast(
      (event) =>
        event.tick === death.tick && event.attacker_steam_id === death.killer_steam_id && event.victim_new_health <= 0,
    );
    const snapshotFor = (steamId: string): PlayerPositionRow | undefined =>
      positions.findLast(
        (event) =>
          event.player_steam_id === steamId &&
          event.is_alive &&
          event.health > 0 &&
          beforeDeath(event, L.snapshotAgeSeconds),
      );
    const snapshot = snapshotFor(input.steamId);
    const liveKills = kills.filter(live);
    const victims = liveKills.map((event) => event.victim_steam_id);
    // Respawns/bot control invalidate elimination-based reasoning for this entire round.
    const eliminationRound =
      new Set(victims).size === victims.length &&
      !liveKills.some((event) => event.is_victim_controlling_bot || event.is_killer_controlling_bot);
    const roster = input.roundPlayers?.filter((player) => player.round_number === round.number) ?? [];
    const uniqueRoster = new Map(roster.map((player) => [player.steam_id, player]));
    const rosterValid =
      uniqueRoster.size === 10 &&
      [...uniqueRoster.values()].filter((player) => player.side === TeamNumber.T).length === 5 &&
      [...uniqueRoster.values()].filter((player) => player.side === TeamNumber.CT).length === 5 &&
      uniqueRoster.get(input.steamId)?.side === side;
    const killedBefore = new Set(
      liveKills.filter((event) => order(event, death) < 0).map((event) => event.victim_steam_id),
    );
    const aliveRoster =
      rosterValid && eliminationRound
        ? [...uniqueRoster.values()].filter((player) => !killedBefore.has(player.steam_id))
        : null;
    const teammates =
      aliveRoster?.filter((player) => player.side === side && player.steam_id !== input.steamId) ?? null;
    const enemies = aliveRoster?.filter((player) => player.side !== side) ?? null;
    const findings: DeathFinding[] = [];
    const evaluatedRules: string[] = [];
    const missingSignals = new Set<DeathSignal>();
    if (!input.shotsComplete) missingSignals.add('shots');
    if (!snapshot) missingSignals.add('positions');
    const evaluate = (
      code: string,
      condition: boolean,
      evidence: number[] = [death.tick],
      measures: DeathMeasure[] = [],
      findingKind: DeathFinding['kind'] = 'observation',
    ): void => {
      const definition = definitions.get(code);
      if (!definition) return;
      evaluatedRules.push(code);
      if (condition)
        findings.push({
          code,
          category: definition.category,
          kind: findingKind,
          evidenceTicks: [...new Set(evidence)].filter(Number.isFinite),
          measures: measures.filter((entry) => Number.isFinite(entry.value)),
        });
    };
    const tactical =
      input.tacticalEligible &&
      rosterValid &&
      eliminationRound &&
      kind === 'enemy' &&
      live(death) &&
      !death.is_killer_controlling_bot;
    if (tactical) {
      const firstKill = liveKills.find((event) => deathKind(event) === 'enemy');
      const openingOrderKnown =
        firstKill &&
        liveKills.filter((event) => deathKind(event) === 'enemy' && order(event, firstKill) === 0).length === 1;
      if (openingOrderKnown) evaluate('opening_death', firstKill === death);
      evaluate(
        'early_round_death',
        death.tick - liveStart <= L.openingSeconds * input.tickrate,
        [liveStart, death.tick],
        [measure('elapsed', (death.tick - liveStart) / input.tickrate, 'seconds')],
      );
      const priorDamage = taken.filter((event) => event.tick < death.tick);
      evaluate(
        'damage_before_death',
        priorDamage.length > 0,
        [...priorDamage.map((event) => event.tick), death.tick],
        [
          measure(
            'damage',
            priorDamage.reduce((sum, event) => sum + actualDamage(event), 0),
            'damage',
          ),
          measure('window', L.contextSeconds, 'seconds'),
        ],
      );
      if (fatalDamage && finite(fatalDamage.victim_health)) {
        evaluate(
          'low_health_before_hit',
          fatalDamage.victim_health > 0 && fatalDamage.victim_health <= L.lowHealth,
          [fatalDamage.tick],
          [measure('health', fatalDamage.victim_health, 'health')],
        );
      }
      const incomingStart = enemyTaken[0];
      if (incomingStart)
        evaluate(
          'very_fast_damage_sequence',
          enemyTaken.length >= 2 && (death.tick - incomingStart.tick) / input.tickrate <= L.fastDamageSeconds,
          [incomingStart.tick, death.tick],
          [measure('elapsed', (death.tick - incomingStart.tick) / input.tickrate, 'seconds')],
        );
      evaluate('headshot_death', death.is_headshot);
      if (input.shotsComplete) {
        const allOwnGunShots = shots.filter(
          (event) =>
            event.player_steam_id === input.steamId &&
            !event.is_player_controlling_bot &&
            gun(event.weapon_name) &&
            live(event) &&
            order(event, death) <= 0,
        );
        const segmentFirstShots = gunShots.filter(
          (event) =>
            event.tick - liveStart >= L.firstShotQuietSeconds * input.tickrate &&
            !allOwnGunShots.some(
              (earlier) =>
                order(earlier, event) < 0 && event.tick - earlier.tick < L.firstShotQuietSeconds * input.tickrate,
            ),
        );
        const firstShot = segmentFirstShots.findLast((event) =>
          finite(event.player_velocity_x, event.player_velocity_y),
        );
        if (firstShot) {
          const speed = Math.hypot(firstShot.player_velocity_x, firstShot.player_velocity_y);
          evaluate(
            'first_shot_high_speed',
            speed >= L.highSpeed,
            [firstShot.tick, death.tick],
            [measure('speed', speed, 'speed')],
            'review',
          );
        }
        const blindShots = gunShots.filter((shot) =>
          blinds.some(
            (event) =>
              event.flashed_steam_id === input.steamId &&
              !event.is_flashed_controlling_bot &&
              finite(event.duration) &&
              event.duration > 0 &&
              event.tick >= liveStart &&
              order(event, shot) <= 0 &&
              (shot.tick - event.tick) / input.tickrate < event.duration,
          ),
        );
        evaluate(
          'firing_while_blind',
          blindShots.length > 0,
          blindShots.map((event) => event.tick),
          [measure('shots', blindShots.length, 'count')],
          'review',
        );
        if (
          finalShot &&
          finite(finalShot.player_velocity_x, finalShot.player_velocity_y) &&
          (death.tick - finalShot.tick) / input.tickrate <= L.finalShotAgeSeconds
        ) {
          const speed = Math.hypot(finalShot.player_velocity_x, finalShot.player_velocity_y);
          evaluate(
            'high_speed_final_shot',
            speed >= L.highSpeed,
            [finalShot.tick, death.tick],
            [measure('speed', speed, 'speed')],
            'review',
          );
        }
        if (incomingStart && (death.tick - incomingStart.tick) / input.tickrate >= L.fastDamageSeconds) {
          const returned = shots.some(
            (event) =>
              event.player_steam_id === input.steamId &&
              !event.is_player_controlling_bot &&
              gun(event.weapon_name) &&
              order(event, incomingStart) >= 0 &&
              order(event, death) <= 0,
          );
          evaluate(
            'no_return_fire',
            !returned,
            [incomingStart.tick, death.tick],
            [measure('elapsed', (death.tick - incomingStart.tick) / input.tickrate, 'seconds')],
            'review',
          );
        }
        if (finalShot && automaticWeapons.has(finalShot.weapon_name)) {
          const sequence = [finalShot];
          for (let index = gunShots.length - 2; index >= 0; index--) {
            const event = gunShots[index];
            if (
              event.weapon_name !== finalShot.weapon_name ||
              event.weapon_id !== finalShot.weapon_id ||
              (sequence[0].tick - event.tick) / input.tickrate > L.firingGapSeconds
            )
              break;
            sequence.unshift(event);
          }
          const first = sequence[0];
          const hadDamage = first && dealt.some((event) => gun(event.weapon_name) && order(event, first) >= 0);
          const measures = [
            measure('shots', sequence.length, 'count'),
            measure('window', L.shotWindowSeconds, 'seconds'),
          ];
          evaluate(
            'spray_without_damage',
            sequence.length >= L.sprayShots && !hadDamage,
            sequence.map((event) => event.tick),
            measures,
            'review',
          );
          evaluate(
            'burst_without_damage',
            sequence.length >= L.burstShots && sequence.length < L.sprayShots && !hadDamage,
            sequence.map((event) => event.tick),
            measures,
            'review',
          );
        }
        if (gunShots.length >= 2) {
          let maximum = 0;
          let evidence: number[] = [];
          let measuredPair = false;
          for (let index = 1; index < gunShots.length; index++) {
            const a = gunShots[index - 1];
            const b = gunShots[index];
            if (
              a.weapon_name === b.weapon_name &&
              a.weapon_id === b.weapon_id &&
              (b.tick - a.tick) / input.tickrate <= L.firingGapSeconds &&
              finite(a.player_yaw, b.player_yaw)
            ) {
              measuredPair = true;
              if (angularDifference(a.player_yaw, b.player_yaw) > maximum) {
                maximum = angularDifference(a.player_yaw, b.player_yaw);
                evidence = [a.tick, b.tick];
              }
            }
          }
          if (measuredPair)
            evaluate(
              'shooting_direction_change',
              maximum >= L.shotDirectionDegrees,
              evidence,
              [measure('angle', maximum, 'degrees')],
              'review',
            );
        }
        const lastThrow = ownShots.findLast((event) => grenades.has(event.weapon_name));
        evaluate(
          'utility_throw_before_death',
          !!lastThrow,
          lastThrow ? [lastThrow.tick, death.tick] : [],
          lastThrow ? [measure('elapsed', (death.tick - lastThrow.tick) / input.tickrate, 'seconds')] : [],
          'review',
        );
      }
      const otherDamage = dealt.filter((event) => event.victim_steam_id !== death.killer_steam_id);
      evaluate(
        'damaged_other_enemy',
        otherDamage.length > 0,
        otherDamage.map((event) => event.tick),
        [
          measure(
            'damage',
            otherDamage.reduce((sum, event) => sum + actualDamage(event), 0),
            'damage',
          ),
        ],
        'review',
      );
      const killerDamage = dealt.filter((event) => event.victim_steam_id === death.killer_steam_id);
      evaluate(
        'high_damage_to_killer',
        killerDamage.reduce((sum, event) => sum + actualDamage(event), 0) >= L.highDamage,
        killerDamage.map((event) => event.tick),
        [
          measure(
            'damage',
            killerDamage.reduce((sum, event) => sum + actualDamage(event), 0),
            'damage',
          ),
        ],
      );
      const recentKill = kills.findLast(
        (event) =>
          event.killer_steam_id === input.steamId && deathKind(event) === 'enemy' && previous(event, L.exchangeSeconds),
      );
      evaluate(
        'death_after_kill',
        !!recentKill,
        recentKill ? [recentKill.tick, death.tick] : [],
        recentKill ? [measure('elapsed', (death.tick - recentKill.tick) / input.tickrate, 'seconds')] : [],
        'review',
      );
      const teammateKilled = kills.findLast(
        (event) =>
          event.killer_steam_id === death.killer_steam_id &&
          event.victim_steam_id !== input.steamId &&
          event.victim_side === side &&
          deathKind(event) === 'enemy' &&
          previous(event, L.exchangeSeconds),
      );
      evaluate(
        'same_enemy_chain',
        !!teammateKilled,
        teammateKilled ? [teammateKilled.tick, death.tick] : [],
        teammateKilled ? [measure('elapsed', (death.tick - teammateKilled.tick) / input.tickrate, 'seconds')] : [],
        'review',
      );
      const trade = liveKills.find(
        (event) =>
          order(event, death) > 0 &&
          event.tick <= death.tick + L.exchangeSeconds * input.tickrate &&
          event.victim_steam_id === death.killer_steam_id &&
          event.killer_side === side &&
          event.killer_steam_id !== input.steamId &&
          deathKind(event) === 'enemy',
      );
      evaluate(
        'traded_death',
        !!trade,
        trade ? [death.tick, trade.tick] : [],
        trade ? [measure('elapsed', (trade.tick - death.tick) / input.tickrate, 'seconds')] : [],
      );
      // A full future window and another living teammate are required for this outcome label.
      if (
        teammates &&
        teammates.length > 0 &&
        !killedBefore.has(death.killer_steam_id) &&
        round.end_tick >= death.tick + L.exchangeSeconds * input.tickrate
      )
        evaluate('untraded_death', !trade, [death.tick], [measure('window', L.exchangeSeconds, 'seconds')], 'review');
      if (teammates && enemies) {
        const counts = [measure('teammates', teammates.length, 'count'), measure('enemies', enemies.length, 'count')];
        evaluate(
          'numerical_advantage',
          teammates.length + 1 > enemies.length && enemies.length > 0,
          [death.tick],
          counts,
          'review',
        );
        evaluate('last_alive', teammates.length === 0 && enemies.length > 0, [death.tick], counts);
      }
      const activeBlinds = blinds.filter(
        (event) =>
          event.flashed_steam_id === input.steamId &&
          !event.is_flashed_controlling_bot &&
          !event.is_flasher_controlling_bot &&
          event.tick >= liveStart &&
          order(event, death) <= 0 &&
          finite(event.duration) &&
          event.duration > (death.tick - event.tick) / input.tickrate,
      );
      for (const [code, matching] of [
        ['enemy_flash', activeBlinds.filter((event) => combatSide(event.flasher_side) && event.flasher_side !== side)],
        [
          'teammate_flash',
          activeBlinds.filter((event) => event.flasher_side === side && event.flasher_steam_id !== input.steamId),
        ],
        ['self_flash', activeBlinds.filter((event) => event.flasher_steam_id === input.steamId)],
      ] as const) {
        evaluate(
          code,
          death.is_victim_blinded && matching.length > 0,
          matching.map((event) => event.tick),
          matching.length
            ? [
                measure(
                  'remaining',
                  Math.max(...matching.map((event) => event.duration - (death.tick - event.tick) / input.tickrate)),
                  'seconds',
                ),
              ]
            : [],
        );
      }
      const fire = (weapon: WeaponName): boolean => weapon === WeaponName.Molotov || weapon === WeaponName.Incendiary;
      const utilityDamage = taken.filter((event) => grenades.has(event.weapon_name));
      for (const [code, matching] of [
        ['self_utility_damage', utilityDamage.filter((event) => event.attacker_steam_id === input.steamId)],
        ['fire_damage_before_death', utilityDamage.filter((event) => fire(event.weapon_name))],
        ['he_damage_before_death', utilityDamage.filter((event) => event.weapon_name === WeaponName.HEGrenade)],
      ] as const)
        evaluate(
          code,
          matching.length > 0,
          matching.map((event) => event.tick),
          [
            measure(
              'damage',
              matching.reduce((sum, event) => sum + actualDamage(event), 0),
              'damage',
            ),
          ],
        );
      const flashedEnemies = blinds.filter(
        (event) =>
          event.flasher_steam_id === input.steamId &&
          !event.is_flasher_controlling_bot &&
          !event.is_flashed_controlling_bot &&
          event.flashed_side !== side &&
          combatSide(event.flashed_side) &&
          finite(event.duration) &&
          event.duration >= 1 &&
          beforeDeath(event, L.exchangeSeconds),
      );
      evaluate(
        'flashed_enemy_before_death',
        flashedEnemies.length > 0,
        flashedEnemies.map((event) => event.tick),
        [measure('enemies', new Set(flashedEnemies.map((event) => event.flashed_steam_id)).size, 'count')],
      );
      evaluate('airborne_death', death.is_victim_airborne);
      evaluate('inspecting_weapon', death.is_victim_inspecting_weapon);
      evaluate('through_smoke_death', death.is_through_smoke);
      if (finite(death.penetrated_objects))
        evaluate(
          'penetration_death',
          death.penetrated_objects > 0,
          [death.tick],
          [measure('objects', death.penetrated_objects, 'count')],
        );
      const recentAttackers = enemyTaken.filter((event) => beforeDeath(event, L.multiAttackerSeconds));
      const attackerCount = new Set(recentAttackers.map((event) => event.attacker_steam_id)).size;
      evaluate(
        'multi_attacker_damage',
        attackerCount >= 2,
        recentAttackers.map((event) => event.tick),
        [measure('attackers', attackerCount, 'count'), measure('window', L.multiAttackerSeconds, 'seconds')],
      );
      if (snapshot) {
        const evidence = [snapshot.tick, death.tick];
        evaluate('crouched_death', snapshot.is_ducking, evidence);
        evaluate('scoped_death', snapshot.is_scoping, evidence);
        evaluate('knife_in_hand', snapshot.active_weapon_name === WeaponName.Knife, evidence);
        evaluate('grenade_in_hand', grenades.has(snapshot.active_weapon_name), evidence);
        evaluate('bomb_in_hand', snapshot.active_weapon_name === WeaponName.Bomb, evidence);
        if (finite(snapshot.armor))
          evaluate('no_armor', snapshot.armor === 0, evidence, [measure('armor', snapshot.armor, 'armor')]);
        evaluate('helmetless_headshot', !snapshot.has_helmet && death.is_headshot, evidence);
        if (snapshot.grenades !== null) {
          const carried = snapshot.grenades
            .split(',')
            .map((value) => value.trim())
            .filter((value) => grenades.has(value as WeaponName));
          evaluate('retained_utility', carried.length > 0, evidence, [measure('grenades', carried.length, 'count')]);
        }
        evaluate('planting_death', snapshot.is_planting, evidence);
        evaluate('defusing_death', snapshot.is_defusing, evidence);
        evaluate('bomb_carrier_death', snapshot.has_bomb, evidence);
        evaluate('kit_carrier_death', snapshot.has_defuse_kit, evidence);
        if (
          finite(snapshot.x, snapshot.y, snapshot.yaw, death.killer_x, death.killer_y) &&
          Math.hypot(death.killer_x - snapshot.x, death.killer_y - snapshot.y) > 1
        ) {
          const bearing = (Math.atan2(death.killer_y - snapshot.y, death.killer_x - snapshot.x) * 180) / Math.PI;
          const difference = angularDifference(bearing, snapshot.yaw);
          evaluate(
            'rear_bearing',
            difference >= L.rearBearingDegrees,
            evidence,
            [measure('angle', difference, 'degrees')],
            'review',
          );
        }
        if (teammates && teammates.length > 0 && finite(snapshot.x, snapshot.y, snapshot.z)) {
          const teammatePositions = teammates.map((player) => snapshotFor(player.steam_id));
          if (teammatePositions.every((position) => position && finite(position.x, position.y, position.z))) {
            const distance = Math.min(
              ...teammatePositions.map((position) =>
                position
                  ? Math.hypot(snapshot.x - position.x, snapshot.y - position.y, snapshot.z - position.z)
                  : Infinity,
              ),
            );
            evaluate(
              'distant_nearest_teammate',
              distance >= L.distantTeammateUnits,
              evidence,
              [measure('distance', distance, 'units')],
              'review',
            );
          }
        }
      }
      const plant = plants.findLast(
        (event) => event.tick >= liveStart && order(event, death) <= 0 && !event.is_planter_controlling_bot,
      );
      evaluate(
        'postplant_t_death',
        !!plant && side === TeamNumber.T,
        plant ? [plant.tick, death.tick] : [],
        plant ? [measure('elapsed', (death.tick - plant.tick) / input.tickrate, 'seconds')] : [],
      );
      evaluate(
        'postplant_ct_death',
        !!plant && side === TeamNumber.CT,
        plant ? [plant.tick, death.tick] : [],
        plant ? [measure('elapsed', (death.tick - plant.tick) / input.tickrate, 'seconds')] : [],
      );
    }
    const startTick = Math.max(Math.ceil(round.start_tick), Math.floor(death.tick - L.contextSeconds * input.tickrate));
    if (!tactical) missingSignals.clear();
    const officialEnd = finite(round.end_officially_tick) ? round.end_officially_tick : round.end_tick;
    const roundEndTick = Math.floor(Math.max(round.end_tick, officialEnd));
    const endTick = Math.max(
      death.tick,
      Math.min(roundEndTick, Math.ceil(death.tick + L.exchangeSeconds * input.tickrate)),
    );
    const timeline: DeathTimelineEvent[] = [];
    const timelineFrames = new Map<string, number>();
    const addEvent = (
      event: Event,
      eventKind: DeathTimelineEvent['kind'],
      actor?: string,
      target?: string,
      weapon?: string,
      value?: number,
    ): void => {
      if (event.tick < startTick || event.tick > endTick) return;
      const id = `${eventKind}:${event.tick}:${event.frame}:${timeline.length}`;
      timelineFrames.set(id, event.frame);
      timeline.push({
        id,
        tick: event.tick,
        seconds: (event.tick - death.tick) / input.tickrate,
        kind: eventKind,
        actor,
        target,
        weapon,
        value: Number.isFinite(value) ? value : undefined,
      });
    };
    for (const event of kills)
      if (
        event.killer_steam_id === input.steamId ||
        event.victim_steam_id === input.steamId ||
        event.victim_steam_id === death.killer_steam_id
      )
        addEvent(
          event,
          event.victim_steam_id === input.steamId ? 'death' : 'kill',
          event.killer_steam_id,
          event.victim_steam_id,
          event.weapon_name,
        );
    for (const event of damages) {
      if (event.victim_steam_id === input.steamId)
        addEvent(
          event,
          'damage-taken',
          event.attacker_steam_id,
          event.victim_steam_id,
          event.weapon_name,
          actualDamage(event),
        );
      else if (event.attacker_steam_id === input.steamId)
        addEvent(
          event,
          'damage-dealt',
          event.attacker_steam_id,
          event.victim_steam_id,
          event.weapon_name,
          actualDamage(event),
        );
    }
    for (const event of shots)
      if (event.player_steam_id === input.steamId)
        addEvent(
          event,
          grenades.has(event.weapon_name) ? 'utility' : 'shot',
          event.player_steam_id,
          undefined,
          event.weapon_name,
        );
    for (const event of blinds)
      if (event.flashed_steam_id === input.steamId || event.flasher_steam_id === input.steamId)
        addEvent(event, 'blind', event.flasher_steam_id, event.flashed_steam_id, WeaponName.Flashbang, event.duration);
    for (const event of plants) addEvent(event, 'plant', event.planter_steam_id);
    for (const event of defuses) addEvent(event, 'defuse', event.defuser_steam_id);
    // Within one recorded frame the source does not expose a reliable sub-frame order.
    timeline.sort((a, b) => a.tick - b.tick || (timelineFrames.get(a.id) ?? 0) - (timelineFrames.get(b.id) ?? 0));
    const distance =
      kind === 'enemy' &&
      finite(death.killer_x, death.killer_y, death.killer_z, death.victim_x, death.victim_y, death.victim_z)
        ? Math.hypot(death.killer_x - death.victim_x, death.killer_y - death.victim_y, death.killer_z - death.victim_z)
        : null;
    records.push({
      id: recordId,
      checksum: input.checksum,
      steamId: input.steamId,
      mapName: input.mapName,
      date: input.date,
      source: input.source,
      roundNumber: round.number,
      side,
      eventTick: death.tick,
      startTick,
      endTick,
      tickrate: input.tickrate,
      kind,
      killerSteamId: death.killer_steam_id && death.killer_steam_id !== '0' ? death.killer_steam_id : null,
      killerName: death.killer_name || null,
      weapon: death.weapon_name,
      roundWon: side !== null && combatSide(round.winner_side) ? round.winner_side === side : null,
      distance,
      range:
        distance === null
          ? null
          : distance < L.closeRangeUnits
            ? 'close'
            : distance >= L.longRangeUnits
              ? 'long'
              : 'medium',
      healthBeforeHit: fatalDamage && finite(fatalDamage.victim_health) ? fatalDamage.victim_health : null,
      teammatesAlive: teammates?.length ?? null,
      enemiesAlive: enemies?.length ?? null,
      findings,
      evaluatedRules,
      missingSignals: [...missingSignals],
      timeline,
      recordingRequest:
        Number.isSafeInteger(startTick) &&
        Number.isSafeInteger(endTick) &&
        startTick <= death.tick &&
        death.tick <= roundEndTick &&
        endTick > startTick
          ? {
              checksum: input.checksum,
              steamId: input.steamId,
              roundNumber: round.number,
              startTick,
              endTick,
              eventTick: death.tick,
              opponentSteamId: kind === 'enemy' ? death.killer_steam_id : undefined,
              includeOpponent: kind === 'enemy',
            }
          : null,
    });
  }
  return records.sort((a, b) => a.roundNumber - b.roundNumber || a.eventTick - b.eventTick);
}
