import { beforeEach, expect, it, vi } from 'vite-plus/test';
import type { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';
import type { Database } from 'csdm/node/database/schema';
import { positionFromCsv } from './position-csv';
import { encodePositionBlock } from './position-block-codec';
import { readPositionRows } from './read-position-rows';
import { fetchPlayersPositions } from './fetch-players-positions';

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
beforeEach(() => {
  mocks.rows.clear();
  mocks.queries.length = 0;
});

function position(tick: number) {
  return positionFromCsv(
    [
      String(tick + 20),
      String(tick),
      '1',
      '10.123456789',
      '-16',
      '64',
      '-90',
      '0',
      '3',
      '800',
      '100',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      'USP-S',
      'Knife',
      '',
      'USP-S',
      '',
      '',
      '',
      '76561198000000000',
      'Synthetic',
      '1',
      'synthetic',
    ],
    tick,
  );
}

it('reads indexed compact blocks, trims windows exactly and matches old observed rows', async () => {
  const rows = [position(4), position(1), position(2), position(3)];
  mocks.rows.set('player_position_blocks', [await encodePositionBlock(rows)]);
  const result = await readPositionRows({
    checksum: 'synthetic',
    roundNumber: 1,
    windows: [{ startTick: 2, endTick: 3 }],
  });
  expect(result).toEqual([position(2), position(3)]);
  expect(mocks.queries).toHaveLength(1);
  expect(mocks.queries[0].sql).toContain('"last_tick" >=');
  expect(mocks.queries[0].sql).toContain('"first_tick" <=');
});

it('keeps old databases readable without reparsing and applies the same range on the legacy query', async () => {
  mocks.rows.set('player_positions', [position(2), position(3)]);
  expect(
    await readPositionRows({
      checksum: 'synthetic',
      roundNumber: 1,
      windows: [{ startTick: 2, endTick: 3 }],
      limit: 10,
    }),
  ).toEqual([position(2), position(3)]);
  expect(mocks.queries[1].parameters).toEqual(['synthetic', 1, 2, 3, 10]);
});

it('returns observed samples for bounded clips, preserves names and never invents a missing tick', async () => {
  mocks.rows.set('player_position_blocks', [await encodePositionBlock([position(1), position(3)])]);
  mocks.rows.set('steam_account_overrides', [{ steam_id: '76561198000000000', name: 'Alias' }]);
  const rows = await fetchPlayersPositions('synthetic', 1, { startTick: 1, endTick: 3 });
  expect(rows.map((row) => row.tick)).toEqual([1, 3]);
  expect(rows.every((row) => row.playerName === 'Alias' && !row.isDucking)).toBe(true);
  const full = await fetchPlayersPositions('synthetic', 1);
  expect(full.map((row) => row.tick)).toEqual([1, 2, 3]);
});

it('rejects corrupted compact evidence instead of silently displaying legacy data', async () => {
  const block = await encodePositionBlock([position(1)]);
  mocks.rows.set('player_position_blocks', [{ ...block, payload_sha256: 'invalid' }]);
  mocks.rows.set('player_positions', [position(2)]);
  await expect(readPositionRows({ checksum: 'synthetic', roundNumber: 1 })).rejects.toThrow('integrity');
  expect(mocks.queries).toHaveLength(1);
});

it('cancels before querying and limits oversized evidence windows', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readPositionRows({ checksum: 'synthetic', roundNumber: 1, signal: controller.signal }),
  ).rejects.toThrow();
  expect(mocks.queries).toHaveLength(0);
  mocks.rows.set('player_position_blocks', [await encodePositionBlock([position(1), position(2), position(3)])]);
  expect(await readPositionRows({ checksum: 'synthetic', roundNumber: 1, limit: 2 })).toHaveLength(2);
});
