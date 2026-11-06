import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseString } from '@fast-csv/parse';
import { afterEach, beforeEach, expect, it } from 'vite-plus/test';
import { streamPositionCsv } from './stream-position-csv';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cs2lighter-csv-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('matches the reference parser across every UTF-8/chunk/quoted-field boundary', async () => {
  const expected = [
    ['1', '玩家🦕', 'AK-47,Knife', '', '76561198000000000'],
    ['2', 'Name "quoted"', 'one\ntwo', 'last', ''],
    ['3', '普通名字', '"', ',,', 'tail'],
  ];
  const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const csv = expected.map((row) => row.map(quote).join(',')).join('\r\n');
  const reference: string[][] = [];
  for await (const row of parseString(csv)) reference.push(row as string[]);
  expect(reference).toEqual(expected);
  const file = path.join(directory, 'positions.csv');
  await writeFile(file, csv);
  for (const chunkSize of [1, 2, 3, 7, 19, 64 * 1024]) {
    const actual: string[][] = [];
    await streamPositionCsv(
      file,
      (row) => {
        actual.push(row);
      },
      chunkSize,
    );
    expect(actual).toEqual(reference);
  }
});

it('pauses the reader while a batch is being persisted and stops immediately on consumer failure', async () => {
  const file = path.join(directory, 'positions.csv');
  await writeFile(file, '1,a\n2,b\n3,c\n');
  const rows: string[][] = [];
  await expect(
    streamPositionCsv(
      file,
      async (row) => {
        rows.push(row);
        await Promise.resolve();
        if (row[0] === '2') throw new Error('insert failed');
      },
      2,
    ),
  ).rejects.toThrow('insert failed');
  expect(rows).toEqual([
    ['1', 'a'],
    ['2', 'b'],
  ]);
});

it('rejects malformed quoting and oversized records while handling empty input and trailing newlines', async () => {
  const file = path.join(directory, 'positions.csv');
  for (const csv of ['x,un"quoted\n', 'x,"unfinished', 'x,"closed"junk\n', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    await writeFile(file, csv);
    await expect(streamPositionCsv(file, () => {})).rejects.toThrow();
  }
  for (const csv of ['', '\n', '\r\n']) {
    await writeFile(file, csv);
    const rows: string[][] = [];
    await streamPositionCsv(file, (row) => {
      rows.push(row);
    });
    expect(rows).toEqual([]);
  }
});
