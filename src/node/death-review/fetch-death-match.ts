import { Game, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { DeathReviewScope } from 'csdm/common/types/death-review';
import { db } from 'csdm/node/database/database';
import { assertMatchImportComplete } from 'csdm/node/database/matches/match-import-state';
import { getDemoCacheGeneration } from 'csdm/node/demo-cache/invalidate-demo-cache';
import type { KillRow } from 'csdm/node/database/kills/kill-table';
import type { PlayerPositionRow } from 'csdm/node/database/player-position/player-position-table';
import type { PlayerEconomyRow } from 'csdm/node/database/player-economies/player-economy-table';
import { buildDeathReviews, type DeathMatchInput } from './build-death-review';
import { deathMatchRevision, type DeathMatchDescriptor } from './death-review-cache';

function descriptorQuery() {
  return db
    .selectFrom('demos as d')
    .innerJoin('matches as m', 'm.checksum', 'd.checksum')
    .select([
      'd.checksum',
      'd.name',
      'd.map_name as mapName',
      'd.date',
      'd.source',
      'd.tickrate',
      'd.network_protocol as networkProtocol',
      'm.analyze_date as analyzeDate',
      'm.game_mode_str as gameMode',
      'm.shot_count as shotCount',
    ])
    .where('d.game', '=', Game.CS2);
}

function descriptor(
  row: Omit<DeathMatchDescriptor, 'date' | 'analyzeDate'> & { date: Date; analyzeDate: Date },
): DeathMatchDescriptor {
  return { ...row, date: row.date.toISOString(), analyzeDate: row.analyzeDate.toISOString() };
}

export async function listDeathMatches(scope: DeathReviewScope) {
  let query = descriptorQuery().where((eb) =>
    eb.exists(
      eb
        .selectFrom('players')
        .select('steam_id')
        .whereRef('match_checksum', '=', 'd.checksum')
        .where('steam_id', '=', scope.steamId),
    ),
  );
  if (scope.checksum !== undefined) query = query.where('d.checksum', '=', scope.checksum);
  if (scope.mapName !== undefined) query = query.where('d.map_name', '=', scope.mapName);
  if (scope.source !== undefined) query = query.where('d.source', '=', scope.source);
  return (await query.orderBy('d.date', 'desc').orderBy('d.checksum').execute()).map(descriptor);
}

export async function isDeathMatchCurrent(match: DeathMatchDescriptor) {
  await assertMatchImportComplete(match.checksum);
  const current = await descriptorQuery().where('d.checksum', '=', match.checksum).executeTakeFirst();
  return current !== undefined && deathMatchRevision(descriptor(current)) === deathMatchRevision(match);
}

export type DeathPositionWindow = { roundNumber: number; startTick: number; endTick: number };

/** Keep only a quarter-second before human deaths; merge overlaps before querying the indexed round. */
export function deathPositionWindows(
  kills: Pick<KillRow, 'round_number' | 'tick' | 'victim_steam_id' | 'is_victim_controlling_bot'>[],
  tickrate: number,
): DeathPositionWindow[] {
  if (!Number.isFinite(tickrate) || tickrate <= 0) return [];
  const width = Math.ceil(tickrate * 0.25);
  const windows = kills
    .filter(
      (kill) =>
        /^\d{17}$/.test(kill.victim_steam_id) &&
        !kill.is_victim_controlling_bot &&
        Number.isSafeInteger(kill.tick) &&
        kill.tick >= 0,
    )
    .map((kill) => ({
      roundNumber: kill.round_number,
      startTick: Math.max(0, kill.tick - width),
      endTick: kill.tick,
    }))
    .sort((a, b) => a.roundNumber - b.roundNumber || a.startTick - b.startTick);
  const merged: DeathPositionWindow[] = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && previous.roundNumber === window.roundNumber && window.startTick <= previous.endTick + 1)
      previous.endTick = Math.max(previous.endTick, window.endTick);
    else merged.push({ ...window });
  }
  return merged;
}

export function deathRoundPlayers(
  economies: Pick<PlayerEconomyRow, 'round_number' | 'player_steam_id' | 'player_side'>[],
) {
  const rounds = new Map<number, Map<string, TeamNumber>>();
  const invalid = new Set<number>();
  for (const economy of economies) {
    if (economy.player_side !== TeamNumber.T && economy.player_side !== TeamNumber.CT) continue;
    const roster = rounds.get(economy.round_number) ?? new Map<string, TeamNumber>();
    const previous = roster.get(economy.player_steam_id);
    if (previous !== undefined && previous !== economy.player_side) invalid.add(economy.round_number);
    roster.set(economy.player_steam_id, economy.player_side);
    rounds.set(economy.round_number, roster);
  }
  return [...rounds].flatMap(([round_number, players]) => {
    if (
      invalid.has(round_number) ||
      players.size !== 10 ||
      [...players.values()].filter((side) => side === TeamNumber.T).length !== 5
    )
      return [];
    return Array.from(players, ([steam_id, side]) => ({ round_number, steam_id, side }));
  });
}

const incompatibleModes = new Set<GameMode>([
  GameMode.Scrimmage2V2,
  GameMode.Deathmatch,
  GameMode.GunGameProgressive,
  GameMode.GunGameBomb,
  GameMode.CoOperative,
  GameMode.CoOperativeMission,
  GameMode.Skirmish,
  GameMode.Survival,
]);

export async function buildDeathMatchFromDatabase(match: DeathMatchDescriptor, signal: AbortSignal) {
  signal.throwIfAborted();
  await assertMatchImportComplete(match.checksum);
  const generation = getDemoCacheGeneration(match.checksum);
  const checksum = match.checksum;
  // Event tables are small. Position rows are deliberately fetched separately in bounded windows.
  const [kills, rounds, damages, shots, blinds, plants, defuses, economies] = await Promise.all([
    db.selectFrom('kills').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('rounds').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('damages').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('shots').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('player_blinds').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('bombs_planted').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('bombs_defuse_start').selectAll().where('match_checksum', '=', checksum).execute(),
    db
      .selectFrom('player_economies')
      .select(['round_number', 'player_steam_id', 'player_side'])
      .where('match_checksum', '=', checksum)
      .execute(),
  ]);
  signal.throwIfAborted();
  const windowsByRound = new Map<number, DeathPositionWindow[]>();
  for (const window of deathPositionWindows(kills, match.tickrate)) {
    const windows = windowsByRound.get(window.roundNumber) ?? [];
    windows.push(window);
    windowsByRound.set(window.roundNumber, windows);
  }
  const positions: PlayerPositionRow[] = [];
  const maximumPositionRows = 100_000;
  for (const [roundNumber, windows] of windowsByRound) {
    signal.throwIfAborted();
    const rows = await db
      .selectFrom('player_positions')
      .selectAll()
      .where('match_checksum', '=', checksum)
      .where('round_number', '=', roundNumber)
      .where((eb) =>
        eb.or(windows.map((window) => eb.and([eb('tick', '>=', window.startTick), eb('tick', '<=', window.endTick)]))),
      )
      .orderBy('tick')
      .orderBy('frame')
      .orderBy('player_steam_id')
      .limit(maximumPositionRows - positions.length + 1)
      .execute();
    positions.push(...rows);
    if (positions.length > maximumPositionRows)
      throw new Error('Death position windows exceed the supported per-match size');
  }
  signal.throwIfAborted();
  const roundPlayers = deathRoundPlayers(economies);
  const input: Omit<DeathMatchInput, 'steamId'> = {
    checksum,
    mapName: match.mapName,
    date: match.date,
    source: match.source,
    tickrate: match.tickrate,
    tacticalEligible: !incompatibleModes.has(match.gameMode) && roundPlayers.length > 0,
    shotsComplete: Number.isSafeInteger(match.shotCount) && match.shotCount >= 0 && shots.length === match.shotCount,
    roundPlayers,
    kills,
    rounds,
    damages,
    shots,
    blinds,
    plants,
    defuses,
    positions,
  };
  const victims = [
    ...new Set(kills.filter((kill) => /^\d{17}$/.test(kill.victim_steam_id)).map((kill) => kill.victim_steam_id)),
  ].sort();
  const records = victims.flatMap((steamId) => buildDeathReviews({ ...input, steamId }));
  signal.throwIfAborted();
  if (getDemoCacheGeneration(checksum) !== generation || !(await isDeathMatchCurrent(match)))
    throw new Error('Match changed while preparing death review; retry this match');
  return records;
}
