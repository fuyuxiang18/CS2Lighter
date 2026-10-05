import { TeamNumber } from 'csdm/common/types/counter-strike';
import type { ReviewDuel, ReviewDuelsPage, ReviewDuelsPayload } from 'csdm/common/types/review-duels';
import type { KillRow } from '../kills/kill-table';
import type { DamageRow } from '../damages/damage-table';
import type { RoundRow } from '../rounds/round-table';

type DuelMatch = { checksum: string; map_name: string; date: Date | string; tickrate: number };
type Input = {
  matches: DuelMatch[];
  kills: KillRow[];
  damages: DamageRow[];
  rounds: RoundRow[];
  players?: { match_checksum: string; steam_id: string; name: string }[];
  participation?: { match_checksum: string; round_number: number; player_side: number }[];
};
function isSide(side: number): side is 2 | 3 {
  return side === TeamNumber.T || side === TeamNumber.CT;
}
function compareEvents(a: KillRow | DamageRow, b: KillRow | DamageRow) {
  return a.tick - b.tick || a.frame - b.frame || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

export function buildReviewDuels(input: Input, payload: ReviewDuelsPayload): ReviewDuelsPage {
  const matches = new Map(
    input.matches
      .filter((match) => Number.isFinite(match.tickrate) && match.tickrate > 0)
      .map((match) => [match.checksum, match]),
  );
  const rounds = new Map(
    input.rounds
      .filter(
        (round) =>
          matches.has(round.match_checksum) &&
          round.number > 0 &&
          round.end_tick > round.start_tick &&
          isSide(round.winner_side),
      )
      .map((round) => [`${round.match_checksum}:${round.number}`, round]),
  );
  const participating =
    input.participation === undefined
      ? undefined
      : new Set(
          input.participation
            .filter((item) => isSide(item.player_side))
            .map((item) => `${item.match_checksum}:${item.round_number}`),
        );
  const firstKills = new Set<string>();
  const openingIds = new Set<string>();
  const names = new Map(
    (input.players ?? []).map((player) => [`${player.match_checksum}:${player.steam_id}`, player.name]),
  );
  const validKills = input.kills
    .filter((kill) => {
      if (kill.killer_name) names.set(`${kill.match_checksum}:${kill.killer_steam_id}`, kill.killer_name);
      if (kill.victim_name) names.set(`${kill.match_checksum}:${kill.victim_steam_id}`, kill.victim_name);
      const round = rounds.get(`${kill.match_checksum}:${kill.round_number}`);
      return (
        round &&
        isSide(kill.killer_side) &&
        isSide(kill.victim_side) &&
        kill.killer_side !== kill.victim_side &&
        kill.killer_steam_id !== kill.victim_steam_id &&
        kill.tick >= round.start_tick &&
        kill.tick <= Math.max(round.end_tick, round.end_officially_tick)
      );
    })
    .toSorted(compareEvents);
  for (const kill of validKills) {
    const key = `${kill.match_checksum}:${kill.round_number}`;
    // Bot kills occupy the first-enemy-elimination slot but never become credited human bot-control kills.
    if (!firstKills.has(key) && kill.tick <= rounds.get(key)!.end_tick) {
      firstKills.add(key);
      openingIds.add(`${kill.match_checksum}:${kill.id}`);
    }
  }
  const events: ReviewDuel[] = [];
  const killEvents = new Map<string, ReviewDuel>();
  const pairKills = new Map<string, KillRow[]>();
  const base = (checksum: string, roundNumber: number, tick: number, lastTick = tick) => {
    const match = matches.get(checksum)!;
    const round = rounds.get(`${checksum}:${roundNumber}`)!;
    const endTick = Math.min(
      Math.max(round.end_tick, round.end_officially_tick),
      Math.ceil(lastTick + 4 * match.tickrate),
    );
    return {
      checksum,
      steamId: payload.steamId,
      mapName: match.map_name,
      date: new Date(match.date).toISOString(),
      roundNumber,
      startTick: Math.max(
        round.start_tick,
        Math.floor(tick - 8 * match.tickrate),
        endTick - Math.floor(45 * match.tickrate),
      ),
      eventTick: tick,
      endTick,
    };
  };
  for (const kill of validKills) {
    const won = kill.killer_steam_id === payload.steamId;
    if (!won && kill.victim_steam_id !== payload.steamId) continue;
    if ((won && kill.is_killer_controlling_bot) || (!won && kill.is_victim_controlling_bot)) continue;
    if (participating && !participating.has(`${kill.match_checksum}:${kill.round_number}`)) continue;
    const side = won ? kill.killer_side : kill.victim_side;
    if (!isSide(side) || (payload.side !== undefined && side !== payload.side)) continue;
    const opponentId = won ? kill.victim_steam_id : kill.killer_steam_id;
    const key = `${kill.match_checksum}:${kill.round_number}:${opponentId}`;
    pairKills.set(key, [...(pairKills.get(key) ?? []), kill]);
    const event: ReviewDuel = {
      ...base(kill.match_checksum, kill.round_number, kill.tick),
      id: `kill:${kill.match_checksum}:${kill.id}`,
      side,
      opponent: won ? kill.victim_name : kill.killer_name,
      weapon: kill.weapon_name,
      kind: won ? 'kill' : 'death',
      opening: openingIds.has(`${kill.match_checksum}:${kill.id}`),
      headshot: kill.is_headshot,
      damageGiven: 0,
      damageTaken: 0,
    };
    events.push(event);
    killEvents.set(event.id, event);
  }
  type Encounter = {
    checksum: string;
    round: number;
    opponentId: string;
    side: 2 | 3;
    first: number;
    last: number;
    weapon: string;
    given: number;
    taken: number;
  };
  const groups = new Map<string, Encounter[]>();
  for (const damage of input.damages.toSorted(compareEvents)) {
    const outgoing = damage.attacker_steam_id === payload.steamId;
    if (!outgoing && damage.victim_steam_id !== payload.steamId) continue;
    if ((outgoing && damage.is_attacker_controlling_bot) || (!outgoing && damage.is_victim_controlling_bot)) continue;
    const side = outgoing ? damage.attacker_side : damage.victim_side;
    const roundKey = `${damage.match_checksum}:${damage.round_number}`;
    const round = rounds.get(roundKey);
    const match = matches.get(damage.match_checksum);
    const healthDamage = Math.max(0, Math.min(damage.health_damage, damage.victim_health));
    if (
      !match ||
      !round ||
      !isSide(side) ||
      !isSide(damage.attacker_side) ||
      !isSide(damage.victim_side) ||
      damage.attacker_side === damage.victim_side ||
      damage.attacker_steam_id === damage.victim_steam_id ||
      !Number.isFinite(healthDamage) ||
      healthDamage <= 0 ||
      damage.tick < round.start_tick ||
      damage.tick > Math.max(round.end_tick, round.end_officially_tick) ||
      (payload.side !== undefined && side !== payload.side) ||
      (participating && !participating.has(roundKey))
    )
      continue;
    const opponentId = outgoing ? damage.victim_steam_id : damage.attacker_steam_id;
    const key = `${damage.match_checksum}:${damage.round_number}:${opponentId}`;
    const encounters = groups.get(key) ?? [];
    let current = encounters.at(-1);
    const crossedKill =
      current && pairKills.get(key)?.some((kill) => kill.tick >= current!.first && kill.tick < damage.tick);
    if (
      !current ||
      crossedKill ||
      damage.tick - current.last > 5 * match.tickrate ||
      damage.tick - current.first > 30 * match.tickrate
    ) {
      current = {
        checksum: damage.match_checksum,
        round: damage.round_number,
        opponentId,
        side,
        first: damage.tick,
        last: damage.tick,
        weapon: damage.weapon_name,
        given: 0,
        taken: 0,
      };
      encounters.push(current);
      groups.set(key, encounters);
    }
    current.last = damage.tick;
    if (outgoing) current.given += healthDamage;
    else current.taken += healthDamage;
  }
  for (const [key, encounters] of groups)
    for (const group of encounters) {
      const rate = matches.get(group.checksum)!.tickrate;
      const kill = pairKills.get(key)?.find((item) => item.tick >= group.last && item.tick <= group.last + 5 * rate);
      if (kill) {
        const event = killEvents.get(`kill:${kill.match_checksum}:${kill.id}`)!;
        event.damageGiven += group.given;
        event.damageTaken += group.taken;
        const round = rounds.get(`${group.checksum}:${group.round}`)!;
        event.startTick = Math.max(
          round.start_tick,
          event.endTick - Math.floor(45 * rate),
          Math.min(event.startTick, Math.floor(group.first - 8 * rate)),
        );
        continue;
      }
      events.push({
        ...base(group.checksum, group.round, group.first, group.last),
        id: `damage:${key}:${group.first}`,
        side: group.side,
        opponent: names.get(`${group.checksum}:${group.opponentId}`) ?? '',
        weapon: group.weapon,
        kind: 'damage',
        opening: false,
        headshot: false,
        damageGiven: group.given,
        damageTaken: group.taken,
      });
    }
  const openingKills = events.filter((item) => item.opening && item.kind === 'kill').length;
  const openingDeaths = events.filter((item) => item.opening && item.kind === 'death').length;
  const filtered = events
    .filter(
      (item) =>
        !payload.filter ||
        payload.filter === 'all' ||
        (payload.filter === 'opening'
          ? item.opening
          : item.kind === (payload.filter === 'kills' ? 'kill' : payload.filter === 'deaths' ? 'death' : 'damage')),
    )
    .toSorted(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.checksum.localeCompare(b.checksum) ||
        a.eventTick - b.eventTick ||
        a.id.localeCompare(b.id),
    );
  const pageSize = 20;
  const page = Math.min(Math.max(0, payload.page ?? 0), Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  return {
    events: filtered.slice(page * pageSize, (page + 1) * pageSize),
    page,
    pageSize,
    total: filtered.length,
    openingKills,
    openingDeaths,
    coverage: 'kills-deaths-damage',
  };
}
