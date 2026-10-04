import { GameMode, RoundEndReason, TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';
import type {
  PersonalMatchStats,
  PersonalRoundStats,
  PersonalStatsSide,
  PersonalWeaponStats,
} from 'csdm/common/types/personal-stats';
import type { DemoRow } from '../demos/demo-table';
import type { MatchRow } from '../matches/match-table';
import type { RoundRow } from '../rounds/round-table';
import type { KillRow } from '../kills/kill-table';
import type { DamageRow } from '../damages/damage-table';
import type { PlayerEconomyRow } from '../player-economies/player-economy-table';
import type { ClutchRow } from '../clutches/clutch-table';
import type { PlayerBlindRow } from '../player-blinds/player-blind-table';
import type { BombPlantedRow } from '../bomb-planted/bomb-planted-table';
import type { BombDefusedRow } from '../bomb-defused/bomb-defused-table';
import type { ShotRow } from '../shots/shot-table';

export type PersonalMatchInput = {
  demo: Pick<DemoRow, 'checksum' | 'date' | 'map_name' | 'source' | 'build_number' | 'tickrate'>;
  match: Pick<MatchRow, 'winner_name' | 'game_mode_str' | 'max_rounds'>;
  players: { steam_id: string; name: string; team_name: string }[];
  rounds: RoundRow[];
  economies: PlayerEconomyRow[];
  kills: KillRow[];
  damages: DamageRow[];
  shots: ShotRow[];
  clutches: ClutchRow[];
  blinds: PlayerBlindRow[];
  plants: BombPlantedRow[];
  defuses: BombDefusedRow[];
};

function playingSide(side: number): side is PersonalStatsSide {
  return side === TeamNumber.T || side === TeamNumber.CT;
}

function emptyRound(round: RoundRow, economy: PlayerEconomyRow): PersonalRoundStats {
  return {
    roundNumber: round.number,
    startTick: round.freeze_time_end_tick || round.start_tick,
    side: economy.player_side as PersonalStatsSide,
    won: round.winner_side === economy.player_side,
    kills: 0,
    deaths: 0,
    assists: 0,
    headshotKills: 0,
    damage: 0,
    utilityDamage: 0,
    friendlyDamage: 0,
    flashAssists: 0,
    tradeKills: 0,
    tradedDeaths: 0,
    openingKill: false,
    openingDeath: false,
    survived: true,
    kast: false,
    clutchOpponents: null,
    clutchWon: false,
    bombPlants: 0,
    bombDefuses: 0,
    flashesThrown: 0,
    smokesThrown: 0,
    heThrown: 0,
    fireThrown: 0,
    decoysThrown: 0,
    enemiesFlashed: 0,
    enemyBlindSeconds: 0,
    teammatesFlashed: 0,
    economyType: economy.type ?? null,
    equipmentValue:
      Number.isFinite(economy.equipment_value) && economy.equipment_value >= 0 ? economy.equipment_value : null,
    moneySpent: Number.isFinite(economy.money_spent) && economy.money_spent >= 0 ? economy.money_spent : null,
    rws: null,
    weapons: [],
  };
}

function weaponStats(round: PersonalRoundStats, weapon: string): PersonalWeaponStats {
  let stats = round.weapons.find((item) => item.weapon === weapon);
  if (!stats) {
    stats = { weapon, kills: 0, headshotKills: 0, damage: 0, shots: 0 };
    round.weapons.push(stats);
  }
  return stats;
}

/** Public FACEIT 2025 RWS rules. Unspecified zero-damage rounds stay missing, never fabricated as zero. */
export function calculateRoundWinShare(
  won: boolean,
  damage: number,
  teamDamage: number,
  objectiveWinner: boolean,
  hasObjective: boolean,
  objectiveKnown = true,
): number | null {
  if (!won) return 0;
  if (teamDamage <= 0 || !Number.isFinite(teamDamage) || (hasObjective && !objectiveKnown)) return null;
  return ((hasObjective ? 70 : 100) * Math.max(0, damage)) / teamDamage + (hasObjective && objectiveWinner ? 30 : 0);
}

const ratingModes = new Set<GameMode>([GameMode.Premier, GameMode.Competitive, GameMode.Scrimmage5V5]);
const incompatibleRatingModes = new Set<GameMode>([
  GameMode.Scrimmage2V2,
  GameMode.Deathmatch,
  GameMode.GunGameProgressive,
  GameMode.GunGameBomb,
  GameMode.CoOperative,
  GameMode.CoOperativeMission,
  GameMode.Skirmish,
  GameMode.Survival,
]);

/** Rebuild only during per-demo cache generation, never on every dashboard request. */
export function buildPersonalMatchStats(input: PersonalMatchInput): PersonalMatchStats[] {
  const { demo, match } = input;
  const rounds = input.rounds
    .filter((round) => round.number > 0 && round.end_tick > round.start_tick && playingSide(round.winner_side))
    .sort((a, b) => a.number - b.number);
  const roundMap = new Map(rounds.map((round) => [round.number, round]));
  const players = new Map<string, PersonalMatchStats>();
  const facts = new Map<number, Map<string, PersonalRoundStats>>();
  const finalRound = rounds.at(-1);
  for (const player of input.players) {
    if (!/^\d{17}$/.test(player.steam_id)) continue;
    const knownWinner = Boolean(
      match.winner_name && finalRound && [finalRound.team_a_name, finalRound.team_b_name].includes(match.winner_name),
    );
    const knownPlayerTeam = Boolean(
      finalRound && [finalRound.team_a_name, finalRound.team_b_name].includes(player.team_name),
    );
    const tied = Boolean(
      !match.winner_name &&
      finalRound &&
      finalRound.team_a_score === finalRound.team_b_score &&
      match.max_rounds > 0 &&
      finalRound.team_a_score + finalRound.team_b_score >= match.max_rounds,
    );
    players.set(player.steam_id, {
      checksum: demo.checksum,
      steamId: player.steam_id,
      name: player.name,
      date: demo.date.toISOString(),
      mapName: demo.map_name,
      source: demo.source,
      gameMode: match.game_mode_str,
      buildNumber: demo.build_number,
      result:
        knownWinner && knownPlayerTeam
          ? match.winner_name === player.team_name
            ? 'win'
            : 'loss'
          : tied
            ? 'tie'
            : 'unknown',
      ratingEligible: ratingModes.has(match.game_mode_str),
      ratingEligibilityBasis: ratingModes.has(match.game_mode_str) ? 'mode' : null,
      demoRoundCount: rounds.length,
      rounds: [],
    });
  }
  for (const economy of input.economies) {
    const round = roundMap.get(economy.round_number);
    const player = players.get(economy.player_steam_id);
    if (!round || !player || !playingSide(economy.player_side)) continue;
    let participants = facts.get(round.number);
    if (!participants) {
      participants = new Map();
      facts.set(round.number, participants);
    }
    // Economy snapshots establish participation. Missing snapshots never become artificial zero-performance rounds.
    if (!participants.has(economy.player_steam_id)) {
      const stats = emptyRound(round, economy);
      participants.set(economy.player_steam_id, stats);
      player.rounds.push(stats);
    }
  }
  function getFact(roundNumber: number, steamId: string, tick: number) {
    const round = roundMap.get(roundNumber);
    if (!round || tick < round.start_tick || tick > Math.max(round.end_tick, round.end_officially_tick))
      return undefined;
    return facts.get(roundNumber)?.get(steamId);
  }
  const rwsDamage = new Map<number, Map<string, number>>();
  const winningTeamDamage = new Map<number, number>();
  for (const event of input.damages) {
    if (!playingSide(event.attacker_side) || !playingSide(event.victim_side)) continue;
    const round = !event.is_attacker_controlling_bot
      ? getFact(event.round_number, event.attacker_steam_id, event.tick)
      : undefined;
    const damage = Math.max(0, Math.min(event.health_damage, event.victim_health));
    const enemy = event.attacker_side !== event.victim_side;
    if (round) {
      if (enemy) {
        round.damage += damage;
        weaponStats(round, event.weapon_name).damage += damage;
        if (
          [WeaponName.HEGrenade, WeaponName.Molotov, WeaponName.Incendiary].includes(
            event.weapon_name as typeof WeaponName.HEGrenade,
          )
        )
          round.utilityDamage += damage;
      } else if (event.attacker_steam_id !== event.victim_steam_id) round.friendlyDamage += damage;
    }
    const definition = roundMap.get(event.round_number);
    if (
      definition &&
      enemy &&
      event.attacker_side === definition.winner_side &&
      event.tick >= definition.start_tick &&
      event.tick <= definition.end_tick
    ) {
      // Include all winning teammates in the denominator, including bots; never redistribute their share to humans.
      winningTeamDamage.set(event.round_number, (winningTeamDamage.get(event.round_number) ?? 0) + damage);
      const byPlayer = rwsDamage.get(event.round_number) ?? new Map<string, number>();
      if (!event.is_attacker_controlling_bot)
        byPlayer.set(event.attacker_steam_id, (byPlayer.get(event.attacker_steam_id) ?? 0) + damage);
      rwsDamage.set(event.round_number, byPlayer);
    }
  }
  const enemyKills = input.kills
    .filter((kill) => {
      const round = roundMap.get(kill.round_number);
      return (
        round &&
        kill.tick >= round.start_tick &&
        kill.tick <= Math.max(round.end_tick, round.end_officially_tick) &&
        playingSide(kill.killer_side) &&
        playingSide(kill.victim_side) &&
        kill.killer_side !== kill.victim_side &&
        kill.killer_steam_id !== kill.victim_steam_id
      );
    })
    .sort(
      (a, b) =>
        a.tick - b.tick || a.frame - b.frame || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
  const openingRounds = new Set<number>();
  const tradedVictims = new Set<string>();
  for (let index = 0; index < enemyKills.length; index++) {
    const kill = enemyKills[index];
    const killer = !kill.is_killer_controlling_bot
      ? getFact(kill.round_number, kill.killer_steam_id, kill.tick)
      : undefined;
    const victim = !kill.is_victim_controlling_bot
      ? getFact(kill.round_number, kill.victim_steam_id, kill.tick)
      : undefined;
    const assister =
      !kill.is_assister_controlling_bot &&
      kill.assister_side === kill.killer_side &&
      kill.assister_steam_id !== kill.killer_steam_id
        ? getFact(kill.round_number, kill.assister_steam_id, kill.tick)
        : undefined;
    if (killer) {
      killer.kills++;
      killer.headshotKills += Number(kill.is_headshot);
      const weapon = weaponStats(killer, kill.weapon_name);
      weapon.kills++;
      weapon.headshotKills += Number(kill.is_headshot);
    }
    if (assister) {
      assister.assists++;
      assister.flashAssists += Number(kill.is_assisted_flash);
    }
    if (!openingRounds.has(kill.round_number) && kill.tick <= roundMap.get(kill.round_number)!.end_tick) {
      openingRounds.add(kill.round_number);
      if (killer) killer.openingKill = true;
      if (victim) victim.openingDeath = true;
    }
    let trade = false;
    for (let previous = index - 1; previous >= 0; previous--) {
      if (!Number.isFinite(demo.tickrate) || demo.tickrate <= 0) break;
      const earlier = enemyKills[previous];
      if ((kill.tick - earlier.tick) / demo.tickrate > 5) break;
      if (
        earlier.round_number !== kill.round_number ||
        earlier.killer_steam_id !== kill.victim_steam_id ||
        earlier.victim_side !== kill.killer_side ||
        earlier.is_killer_controlling_bot ||
        kill.is_victim_controlling_bot
      )
        continue;
      trade = true;
      const key = `${earlier.round_number}:${earlier.victim_steam_id}`;
      if (!earlier.is_victim_controlling_bot && !tradedVictims.has(key)) {
        const traded = getFact(earlier.round_number, earlier.victim_steam_id, earlier.tick);
        if (traded) traded.tradedDeaths++;
        tradedVictims.add(key);
      }
    }
    if (trade && killer) killer.tradeKills++;
  }
  // All deaths count, including suicide, world and friendly fire; those events never become credited kills.
  for (const kill of input.kills) {
    const victim = !kill.is_victim_controlling_bot
      ? getFact(kill.round_number, kill.victim_steam_id, kill.tick)
      : undefined;
    if (victim) {
      victim.deaths++;
      victim.survived = false;
    }
  }
  for (const shot of input.shots) {
    const round = !shot.is_player_controlling_bot
      ? getFact(shot.round_number, shot.player_steam_id, shot.tick)
      : undefined;
    if (!round) continue;
    switch (shot.weapon_name) {
      case WeaponName.Flashbang:
        round.flashesThrown++;
        break;
      case WeaponName.Smoke:
        round.smokesThrown++;
        break;
      case WeaponName.HEGrenade:
        round.heThrown++;
        break;
      case WeaponName.Molotov:
      case WeaponName.Incendiary:
        round.fireThrown++;
        break;
      case WeaponName.Decoy:
        round.decoysThrown++;
        break;
      default:
        if (
          ![WeaponName.Knife, WeaponName.Bomb, WeaponName.World, WeaponName.Unknown].includes(
            shot.weapon_name as typeof WeaponName.Knife,
          )
        )
          weaponStats(round, shot.weapon_name).shots++;
    }
  }
  for (const blind of input.blinds) {
    const round = !blind.is_flasher_controlling_bot
      ? getFact(blind.round_number, blind.flasher_steam_id, blind.tick)
      : undefined;
    if (!round || !playingSide(blind.flashed_side) || blind.duration <= 0) continue;
    if (blind.flasher_side !== blind.flashed_side) {
      round.enemyBlindSeconds += blind.duration;
      if (blind.duration > 1) round.enemiesFlashed++;
    } else if (blind.flasher_steam_id !== blind.flashed_steam_id && blind.duration > 1) round.teammatesFlashed++;
  }
  for (const clutch of input.clutches.toSorted((a, b) => a.tick - b.tick)) {
    const round = getFact(clutch.round_number, clutch.clutcher_steam_id, clutch.tick);
    if (
      round &&
      round.clutchOpponents === null &&
      clutch.opponent_count > 0 &&
      clutch.tick <= roundMap.get(clutch.round_number)!.end_tick
    ) {
      round.clutchOpponents = clutch.opponent_count;
      round.clutchWon = clutch.won;
    }
  }
  const objectivePlayers = new Map<number, string>();
  for (const plant of input.plants) {
    const round = !plant.is_planter_controlling_bot
      ? getFact(plant.round_number, plant.planter_steam_id, plant.tick)
      : undefined;
    if (round) round.bombPlants++;
    if (roundMap.get(plant.round_number)?.end_reason === RoundEndReason.TargetBombed)
      objectivePlayers.set(plant.round_number, plant.is_planter_controlling_bot ? '' : plant.planter_steam_id);
  }
  for (const defuse of input.defuses) {
    const round = !defuse.is_defuser_controlling_bot
      ? getFact(defuse.round_number, defuse.defuser_steam_id, defuse.tick)
      : undefined;
    if (round) round.bombDefuses++;
    if (roundMap.get(defuse.round_number)?.end_reason === RoundEndReason.BombDefused)
      objectivePlayers.set(defuse.round_number, defuse.is_defuser_controlling_bot ? '' : defuse.defuser_steam_id);
  }
  const rosters = Array.from(facts.values(), (participants) => ({
    t: [...participants.values()].filter((round) => round.side === TeamNumber.T).length,
    ct: [...participants.values()].filter((round) => round.side === TeamNumber.CT).length,
  }));
  const overcrowded = rosters.some((roster) => roster.t > 5 || roster.ct > 5);
  const respawnEvidence = [...players.values()].some((player) =>
    player.rounds.some((round) => round.deaths > 1 || round.kills > 5),
  );
  const standardLength =
    [24, 30].includes(match.max_rounds) ||
    Boolean(finalRound && Math.max(finalRound.team_a_score, finalRound.team_b_score) >= 13);
  // Third-party servers may record Casual even for a standard 5v5 match. Retain that metadata,
  // but allow an explicitly documented structural fallback rather than silently dropping its rating.
  const observed5v5 =
    rounds.length >= 5 && rosters.some((roster) => roster.t === 5 && roster.ct === 5) && standardLength;
  const ratingBasis =
    incompatibleRatingModes.has(match.game_mode_str) || overcrowded || respawnEvidence
      ? null
      : ratingModes.has(match.game_mode_str)
        ? 'mode'
        : observed5v5
          ? 'observed-5v5'
          : null;
  for (const player of players.values()) {
    player.rounds.sort((a, b) => a.roundNumber - b.roundNumber);
    player.ratingEligibilityBasis = ratingBasis;
    player.ratingEligible = ratingBasis !== null;
    for (const round of player.rounds) {
      const definition = roundMap.get(round.roundNumber)!;
      round.kast = round.kills > 0 || round.assists > 0 || round.survived || round.tradedDeaths > 0;
      const objective = [RoundEndReason.TargetBombed, RoundEndReason.BombDefused].includes(
        definition.end_reason as typeof RoundEndReason.TargetBombed,
      );
      round.rws = calculateRoundWinShare(
        round.won,
        rwsDamage.get(round.roundNumber)?.get(player.steamId) ?? 0,
        winningTeamDamage.get(round.roundNumber) ?? 0,
        objectivePlayers.get(round.roundNumber) === player.steamId,
        objective,
        objectivePlayers.has(round.roundNumber),
      );
    }
  }
  return [...players.values()].sort((a, b) => a.steamId.localeCompare(b.steamId));
}
