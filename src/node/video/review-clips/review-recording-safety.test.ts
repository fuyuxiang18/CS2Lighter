import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { assertReviewGameFiles } from './assert-review-game-files';
import { buildReviewHlaeCommands } from './create-review-hlae-commands';
import { findReviewGameProcesses } from './review-recording-processes';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true })));
});

it('refuses pre-existing plugin state without modifying any game file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-game-safety-'));
  directories.push(root);
  const folder = path.join(root, 'game', 'csgo');
  await fs.mkdir(folder, { recursive: true });
  const original = Buffer.from('original game info\r\n');
  await fs.writeFile(path.join(folder, 'gameinfo.gi'), original);
  await expect(assertReviewGameFiles(root)).resolves.toBeUndefined();
  await fs.writeFile(path.join(folder, 'gameinfo.gi.backup'), 'user backup');
  await expect(assertReviewGameFiles(root)).rejects.toMatchObject({ issue: 'game-files-conflict' });
  expect(await fs.readFile(path.join(folder, 'gameinfo.gi'))).toEqual(original);
  expect(await fs.readFile(path.join(folder, 'gameinfo.gi.backup'), 'utf8')).toBe('user backup');
  await fs.unlink(path.join(folder, 'gameinfo.gi.backup'));
  await fs.mkdir(path.join(folder, 'csdm'));
  await fs.writeFile(path.join(folder, 'csdm', 'user-file'), 'preserve');
  await expect(assertReviewGameFiles(root)).rejects.toMatchObject({ issue: 'game-files-conflict' });
  expect(await fs.readFile(path.join(folder, 'csdm', 'user-file'), 'utf8')).toBe('preserve');
});

it('preserves player and tick actions and safely encodes HLAE schedule XML', () => {
  const xml = buildReviewHlaeCommands([
    { tick: 1024, cmd: 'spec_mode 1' },
    { tick: 1024, cmd: 'spec_player 7' },
    { tick: 1024, cmd: 'echo a&b<c>' },
    { tick: 1080, cmd: 'pause_playback' },
    { tick: 1088, cmd: 'mirv_streams record start' },
    { tick: 1856, cmd: 'mirv_streams record end' },
  ]);
  expect(xml).toContain('<c tick="1024">spec_mode 1</c><c tick="1024">spec_player 7</c>');
  expect(xml).toContain('a&amp;b&lt;c&gt;');
  expect(xml).toContain('<c tick="1856">mirv_streams record end</c>');
  expect(xml).not.toContain('pause_playback');
});

it('only selects the game launched with this exact staged demo for cancellation', () => {
  const processes = [
    { ProcessId: 1, CommandLine: 'cs2.exe -insecure +playdemo "D:\\review\\unique-id\\source.dem"' },
    { ProcessId: 2, CommandLine: 'cs2.exe +playdemo "D:\\other\\source.dem"' },
    { ProcessId: 3, CommandLine: null },
    { ProcessId: 4, CommandLine: 'cs2.exe -insecure' },
    { ProcessId: 5, CommandLine: 'cs2.exe +playdemo "D:/review/unique-id/source.dem.other"' },
  ];
  expect(findReviewGameProcesses(processes, 'd:/review/unique-id/source.dem')).toEqual([1]);
});
