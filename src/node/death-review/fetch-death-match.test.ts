import { expect, it, vi } from 'vite-plus/test';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { deathPositionWindows, deathRoundPlayers } from './fetch-death-match';

vi.mock('csdm/node/database/database', () => ({ db: {} }));
vi.mock('csdm/node/database/matches/match-import-state', () => ({
  assertMatchImportComplete: vi.fn(),
}));
vi.mock('csdm/node/demo-cache/invalidate-demo-cache', () => ({ getDemoCacheGeneration: () => 0 }));

it('bounds position queries to real death windows and merges overlaps without joining different rounds', () => {
  const kills = [
    {
      round_number: 1,
      tick: 100,
      victim_steam_id: '76561198000000001',
      is_victim_controlling_bot: false,
    },
    {
      round_number: 1,
      tick: 112,
      victim_steam_id: '76561198000000002',
      is_victim_controlling_bot: false,
    },
    {
      round_number: 1,
      tick: 200,
      victim_steam_id: '76561198000000003',
      is_victim_controlling_bot: false,
    },
    {
      round_number: 2,
      tick: 100,
      victim_steam_id: '76561198000000001',
      is_victim_controlling_bot: false,
    },
    { round_number: 2, tick: 200, victim_steam_id: 'BOT', is_victim_controlling_bot: false },
    {
      round_number: 2,
      tick: 300,
      victim_steam_id: '76561198000000004',
      is_victim_controlling_bot: true,
    },
  ];
  const before = structuredClone(kills);
  expect(deathPositionWindows(kills, 64)).toEqual([
    { roundNumber: 1, startTick: 84, endTick: 112 },
    { roundNumber: 1, startTick: 184, endTick: 200 },
    { roundNumber: 2, startTick: 84, endTick: 100 },
  ]);
  expect(deathPositionWindows(kills, 0)).toEqual([]);
  expect(deathPositionWindows(kills, Number.NaN)).toEqual([]);
  expect(kills).toEqual(before);
});

it('supplies round rosters only with ten distinct players, five per side, and no contradictory side records', () => {
  const players = Array.from({ length: 10 }, (_, index) => ({
    round_number: 1,
    player_steam_id: `7656119800000000${index}`,
    player_side: index < 5 ? TeamNumber.T : TeamNumber.CT,
  }));
  expect(deathRoundPlayers([...players, players[0]])).toHaveLength(10);
  expect(deathRoundPlayers(players.slice(1))).toEqual([]);
  expect(deathRoundPlayers([...players, { ...players[0], player_side: TeamNumber.CT }])).toEqual([]);
  expect(deathRoundPlayers([...players, { ...players[0], player_steam_id: '76561198000000011' }])).toEqual([]);
});
