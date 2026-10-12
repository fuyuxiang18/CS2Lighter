import { beforeEach, expect, it, vi } from 'vite-plus/test';
import type { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';
import { DemoSource, GameMode, TeamNumber, WeaponName, WeaponType } from 'csdm/common/types/counter-strike';
import type { Database } from 'csdm/node/database/schema';
import type { DeathMatchDescriptor } from './death-review-cache';
import { buildDeathMatchFromDatabase, listDeathMatches } from './fetch-death-match';

const mocks = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
  queries: [] as { sql: string; parameters: readonly unknown[] }[],
}));
vi.mock('csdm/node/database/database', async () => {
  const { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } = await import('kysely');
  class SyntheticDriver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({
        executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
          mocks.queries.push({ sql: query.sql, parameters: query.parameters });
          const table = query.sql.match(/from "([a-z_]+)"/)?.[1] ?? '';
          return Promise.resolve({ rows: (mocks.rows.get(table) ?? []) as R[] });
        },
        async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
          yield await Promise.resolve({ rows: [] });
        },
      });
    }
  }
  return {
    db: new Kysely<Database>({
      dialect: {
        createDriver: () => new SyntheticDriver(),
        createAdapter: () => new PostgresAdapter(),
        createIntrospector: (database) => new PostgresIntrospector(database),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    }),
  };
});
vi.mock('csdm/node/database/matches/match-import-state', () => ({ assertMatchImportComplete: vi.fn() }));
vi.mock('csdm/node/demo-cache/invalidate-demo-cache', () => ({ getDemoCacheGeneration: () => 0 }));
beforeEach(() => {
  mocks.rows.clear();
  mocks.queries.length = 0;
});

function syntheticMatch(tickrate: number): DeathMatchDescriptor {
  const match = {
    checksum: 'abcdef',
    name: 'Synthetic demo',
    analyzeDate: '2026-10-12T00:00:00.000Z',
    mapName: 'de_dust2',
    date: '2026-10-11T00:00:00.000Z',
    source: DemoSource.Valve,
    tickrate,
    networkProtocol: 14089,
    gameMode: GameMode.Casual,
    shotCount: 0,
  };
  mocks.rows.set('demos', [{ ...match, date: new Date(match.date), analyzeDate: new Date(match.analyzeDate) }]);
  return match;
}

it('keeps deaths with invalid tickrates and human victims controlling bots without querying full positions', async () => {
  const match = syntheticMatch(0);
  mocks.rows.set(
    'kills',
    [false, true].map((is_victim_controlling_bot, index) => ({
      id: String(index),
      match_checksum: match.checksum,
      round_number: 1,
      tick: 1000 + index,
      frame: 1000 + index,
      victim_steam_id: `7656119800000000${index + 1}`,
      is_victim_controlling_bot,
      victim_side: TeamNumber.T,
      killer_steam_id: '76561198000000003',
      killer_name: 'Synthetic opponent',
      killer_side: TeamNumber.CT,
      weapon_name: WeaponName.AK47,
      weapon_type: WeaponType.Rifle,
    })),
  );
  const records = await buildDeathMatchFromDatabase(match, new AbortController().signal);
  expect(records).toHaveLength(2);
  expect(records.map((record) => record.steamId)).toEqual(['76561198000000001', '76561198000000002']);
  expect(records.every((record) => record.recordingRequest === null && record.evaluatedRules.length === 0)).toBe(true);
  expect(mocks.queries.some((query) => query.sql.includes('from "player_positions"'))).toBe(false);
});

it('filters matches by identity, map, source and checksum in SQL and bounds raw snapshot reads by round and ticks', async () => {
  const match = syntheticMatch(64);
  await listDeathMatches({
    steamId: '76561198000000001',
    checksum: match.checksum,
    mapName: match.mapName,
    source: match.source,
  });
  const query = mocks.queries[0];
  expect(query.sql).toContain('exists (select "steam_id" from "players"');
  expect(query.sql).toContain('"d"."map_name" =');
  expect(query.sql).toContain('"d"."source" =');
  expect(query.parameters).toContain('76561198000000001');
  expect(query.parameters).toContain(match.checksum);
  mocks.rows.set('kills', [
    {
      id: '1',
      match_checksum: match.checksum,
      round_number: 2,
      tick: 1000,
      frame: 1000,
      victim_steam_id: '76561198000000001',
      is_victim_controlling_bot: false,
      victim_side: TeamNumber.T,
      killer_steam_id: '76561198000000003',
      killer_name: 'Synthetic opponent',
      killer_side: TeamNumber.CT,
      weapon_name: WeaponName.AK47,
      weapon_type: WeaponType.Rifle,
    },
  ]);
  await buildDeathMatchFromDatabase(match, new AbortController().signal);
  const snapshots = mocks.queries.filter((query) => query.sql.includes('from "player_positions"'));
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].sql).toContain('"round_number" =');
  expect(snapshots[0].sql).toContain('"tick" >=');
  expect(snapshots[0].sql).toContain('"tick" <=');
  expect(snapshots[0].sql).toContain('order by "tick", "frame", "player_steam_id" limit');
  expect(snapshots[0].parameters).toEqual([match.checksum, 2, 984, 1000, 100001]);
});
