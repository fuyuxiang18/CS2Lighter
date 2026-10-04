import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { defaultSettings } from './default-settings';
import { migrateSettings } from './migrate-settings';
import { updateSettings } from './update-settings';
import { CURRENT_SCHEMA_VERSION } from './schema-version';

const state = vi.hoisted(() => ({ filePath: '' }));
vi.mock('./get-settings-file-path', () => ({ getSettingsFilePath: () => state.filePath }));

let folderPath: string;

beforeEach(async () => {
  folderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2lighter-locale-'));
  state.filePath = path.join(folderPath, 'settings.json');
});

afterEach(async () => {
  const resolved = path.resolve(folderPath);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('cs2lighter-locale-')
  ) {
    throw new Error('Unexpected locale test directory');
  }
  await fs.rm(resolved, { recursive: true, force: true });
});

describe('saved language preferences', () => {
  it('creates a Chinese default on a fresh profile', async () => {
    const settings = await migrateSettings();
    expect(settings.ui.locale).toBe('zh-CN');
    expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(JSON.parse(await fs.readFile(state.filePath, 'utf8')).ui.locale).toBe('zh-CN');
  });

  it('migrates v0.1 English once and preserves later English/Chinese choices on disk', async () => {
    const previous = structuredClone(defaultSettings);
    previous.schemaVersion = 15;
    previous.ui.locale = 'en';
    previous.folders = [{ path: 'D:\\demos', includeSubFolders: true }];
    await fs.writeFile(state.filePath, JSON.stringify(previous));

    const migrated = await migrateSettings();
    expect(migrated.ui.locale).toBe('zh-CN');
    expect(migrated.folders).toEqual(previous.folders);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    await updateSettings({ ui: { locale: 'en' } });
    expect((await migrateSettings()).ui.locale).toBe('en');
    expect(JSON.parse(await fs.readFile(state.filePath, 'utf8')).ui.locale).toBe('en');

    await updateSettings({ ui: { locale: 'zh-CN' } });
    expect((await migrateSettings()).ui.locale).toBe('zh-CN');
    expect(JSON.parse(await fs.readFile(state.filePath, 'utf8')).ui.locale).toBe('zh-CN');
  });
});
