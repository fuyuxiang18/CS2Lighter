import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { Insertable } from 'kysely';
import type { PositionBlockTable } from './position-block-table';
import { insertPositionBlocks } from './insert-position-blocks';
import { decodePositionBlock } from './position-block-codec';

type Block = Omit<Insertable<PositionBlockTable>, 'id'>;
const mocks = vi.hoisted(() => ({ committed: [] as Block[], staged: [] as Block[] }));
vi.mock('csdm/node/database/database', () => ({
  db: {
    transaction: () => ({
      execute: async (callback: (transaction: unknown) => Promise<void>) => {
        mocks.staged = [];
        try {
          await callback({
            insertInto: () => ({
              values: (block: Block) => ({
                execute: () => {
                  mocks.staged.push(block);
                  return Promise.resolve();
                },
              }),
            }),
          });
          mocks.committed = mocks.staged;
        } finally {
          mocks.staged = [];
        }
      },
    }),
  },
}));

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cs2lighter-position-import-'));
  mocks.committed = [];
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function csv(tick: number, steamId = '76561198000000000') {
  return [
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
    steamId,
    'Synthetic',
    '1',
    'synthetic',
  ].join(',');
}

it('streams interleaved players into bounded blocks and preserves every CSV observation and ordinal', async () => {
  const lines = Array.from({ length: 5000 }, (_, index) => csv(Math.floor(index / 2), `7656119800000000${index % 2}`));
  const file = path.join(directory, 'positions.csv');
  await writeFile(file, lines.join('\n'));
  await insertPositionBlocks(file);
  expect(mocks.committed.length).toBeGreaterThan(2);
  expect(mocks.committed.every((block) => block.row_count <= 2048)).toBe(true);
  const rows = (await Promise.all(mocks.committed.map(decodePositionBlock)))
    .flat()
    .sort((a, b) => Number(a.id) - Number(b.id));
  expect(rows).toHaveLength(5000);
  for (let index = 0; index < rows.length; index++) {
    expect(rows[index]).toMatchObject({
      id: index + 1,
      tick: Math.floor(index / 2),
      x: 10.123456789,
      player_steam_id: `7656119800000000${index % 2}`,
    });
  }
});

it('does not commit partial tracks when a later CSV row is invalid', async () => {
  const file = path.join(directory, 'positions.csv');
  await writeFile(file, [...Array.from({ length: 2100 }, (_, index) => csv(index)), 'broken,row'].join('\n'));
  await expect(insertPositionBlocks(file)).rejects.toThrow('columns');
  expect(mocks.committed).toEqual([]);
});

it('rejects unavailable or malformed streams without leaving a reader running', async () => {
  await expect(insertPositionBlocks(path.join(directory, 'missing.csv'))).rejects.toThrow();
  const file = path.join(directory, 'positions.csv');
  await writeFile(file, '"unterminated');
  await expect(insertPositionBlocks(file)).rejects.toThrow();
  expect(mocks.committed).toEqual([]);
});
