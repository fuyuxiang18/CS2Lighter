import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiVault } from './ai-vault';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS, MAX_AI_MAX_OUTPUT_TOKENS } from 'csdm/common/ai-token-limit';

const config = { provider: 'openai-compatible' as const, baseUrl: 'https://example.com/v1', model: 'fixture-model' };
const directories: string[] = [];

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2lighter-ai-vault-'));
  directories.push(directory);
  const file = path.join(directory, 'ai-config.json');
  // An opaque in-memory fake exercises vault handling without pretending to test OS encryption.
  const secrets = new Map<string, string>();
  const storage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => {
      const token = randomUUID();
      secrets.set(token, value);
      return Buffer.from(token);
    }),
    decryptString: vi.fn((value: Buffer) => {
      const secret = secrets.get(value.toString());
      if (secret === undefined) throw new Error('Synthetic decryption failure');
      return secret;
    }),
  };
  return { directory, file, storage, vault: new AiVault(file, storage) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()))
      throw new Error('Unexpected test directory');
    await fs.remove(directory);
  }
});

describe('AI credentials vault', () => {
  it('returns editable defaults on a fresh install without creating a file or decrypting a key', async () => {
    const { vault, file, storage } = await setup();
    expect(await vault.getConfiguration()).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
      hasApiKey: false,
      secureStorageAvailable: true,
    });
    expect(await fs.pathExists(file)).toBe(false);
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  it('persists only encrypted material and never returns secrets from the public configuration', async () => {
    const { vault, file } = await setup();
    const publicConfig = await vault.save({ ...config, apiKey: 'fixture-secret-key' });
    expect(publicConfig).toMatchObject({ ...config, hasApiKey: true });
    expect(JSON.stringify(publicConfig)).not.toContain('fixture-secret-key');
    expect(await fs.readFile(file, 'utf8')).not.toContain('fixture-secret-key');
    expect(await vault.getConfiguration()).not.toHaveProperty('encryptedKey');
    expect((await vault.getCredentials()).apiKey).toBe('fixture-secret-key');
  });

  it('retains a key for the normalized endpoint when changing only the model', async () => {
    const { vault, storage } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-secret-key' });
    await vault.save({ ...config, baseUrl: `${config.baseUrl}/chat/completions`, model: 'another-model' });
    expect((await vault.getCredentials()).apiKey).toBe('fixture-secret-key');
    expect(storage.encryptString).toHaveBeenCalledTimes(1);
  });

  it('reads legacy configurations with the default limit without rewriting or re-encrypting them', async () => {
    const { vault, file, storage } = await setup();
    const encryptedKey = storage.encryptString('fixture-legacy-key').toString('base64');
    await fs.writeJson(file, { ...config, encryptedKey });
    const previousBytes = await fs.readFile(file, 'utf8');
    expect(await vault.getConfiguration()).toMatchObject({ ...config, maxOutputTokens: 240000, hasApiKey: true });
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect((await vault.getCredentials()).config.maxOutputTokens).toBe(240000);
    expect((await vault.getCredentials()).apiKey).toBe('fixture-legacy-key');
    expect(await fs.readFile(file, 'utf8')).toBe(previousBytes);
    expect(storage.encryptString).toHaveBeenCalledTimes(1);
    await vault.save({ ...config, maxOutputTokens: 8000 });
    expect((await fs.readJson(file)).encryptedKey).toBe(encryptedKey);
    expect((await fs.readJson(file)).maxOutputTokens).toBe(8000);
    expect(storage.encryptString).toHaveBeenCalledTimes(1);
  });

  it('persists an explicit output limit across vault instances while retaining the key', async () => {
    const { vault, file, storage } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-secret-key', maxOutputTokens: 1 });
    const ciphertext = (await fs.readJson(file)).encryptedKey;
    await vault.save({ ...config, maxOutputTokens: MAX_AI_MAX_OUTPUT_TOKENS });
    const fresh = new AiVault(file, storage);
    expect((await fresh.getConfiguration()).maxOutputTokens).toBe(MAX_AI_MAX_OUTPUT_TOKENS);
    expect((await fresh.getCredentials()).apiKey).toBe('fixture-secret-key');
    expect((await fs.readJson(file)).encryptedKey).toBe(ciphertext);
    expect(await fs.readFile(file, 'utf8')).not.toContain('fixture-secret-key');
    expect(storage.encryptString).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid output limits before writing or replacing an existing key', async () => {
    const { vault, file, storage, directory } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-old-key', maxOutputTokens: 12000 });
    const previousBytes = await fs.readFile(file, 'utf8');
    for (const invalid of [0, -1, 1.5, MAX_AI_MAX_OUTPUT_TOKENS + 1, NaN, Infinity, '240000', null]) {
      await expect(
        vault.save({ ...config, apiKey: 'fixture-new-key', maxOutputTokens: invalid as number }),
      ).rejects.toThrow('invalid-configuration');
      expect(await fs.readFile(file, 'utf8')).toBe(previousBytes);
    }
    expect(storage.encryptString).toHaveBeenCalledTimes(1);
    expect((await vault.getCredentials()).apiKey).toBe('fixture-old-key');
    expect((await vault.getConfiguration()).maxOutputTokens).toBe(12000);
    expect(await fs.readdir(directory)).toEqual(['ai-config.json']);
  });

  it('drops the previous key when changing the endpoint or provider, and accepts an explicit new key', async () => {
    const { vault } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-old-key' });
    await vault.save({ ...config, baseUrl: 'https://other.example/v1' });
    expect(await vault.getCredentials()).not.toHaveProperty('apiKey');
    await vault.save({ ...config, baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'fixture-local-key' });
    await vault.save({ ...config, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(await vault.getCredentials()).not.toHaveProperty('apiKey');
    await vault.save({ ...config, clearApiKey: true, apiKey: 'fixture-replacement-key' });
    expect((await vault.getCredentials()).apiKey).toBe('fixture-replacement-key');
    await vault.save({ ...config, clearApiKey: true });
    expect((await vault.getConfiguration()).hasApiKey).toBe(false);
    expect(await vault.getCredentials()).not.toHaveProperty('apiKey');
  });

  it('fails closed when encryption or decryption is unavailable, without overwriting the saved configuration', async () => {
    const { vault, file, storage } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-old-key' });
    const before = await fs.readFile(file, 'utf8');
    storage.isEncryptionAvailable.mockReturnValue(false);
    await expect(vault.save({ ...config, apiKey: 'fixture-new-key' })).rejects.toThrow('secure-storage-unavailable');
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    await expect(vault.getCredentials()).rejects.toThrow('key-unavailable');
    storage.isEncryptionAvailable.mockReturnValue(true);
    storage.decryptString.mockImplementation(() => {
      throw new Error('Synthetic private storage message');
    });
    await expect(vault.getCredentials()).rejects.toThrow('key-unavailable');
    expect((await vault.getConfiguration()).hasApiKey).toBe(true);
  });

  it('rejects the basic_text fallback even when Electron reports encryption is available', async () => {
    const { file, storage } = await setup();
    const vault = new AiVault(file, { ...storage, getSelectedStorageBackend: () => 'basic_text' });
    expect((await vault.getConfiguration()).secureStorageAvailable).toBe(false);
    await expect(vault.save({ ...config, apiKey: 'fixture-secret-key' })).rejects.toThrow('secure-storage-unavailable');
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(await fs.pathExists(file)).toBe(false);
    await vault.save({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture-local-model' });
    expect(await vault.getCredentials()).not.toHaveProperty('apiKey');
  });

  it('keeps the previous configuration and removes its temporary file after a failed replacement', async () => {
    const { vault, file, directory } = await setup();
    await vault.save({ ...config, apiKey: 'fixture-old-key' });
    const before = await fs.readFile(file, 'utf8');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Synthetic private filesystem message'));
    await expect(vault.save({ ...config, model: 'replacement-model', maxOutputTokens: 500000 })).rejects.toThrow(
      'storage-failed',
    );
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(await fs.readdir(directory)).toEqual(['ai-config.json']);
    expect((await vault.getCredentials()).apiKey).toBe('fixture-old-key');
  });

  it('rejects overlapping writes and malformed credentials without damaging a valid configuration', async () => {
    const { vault } = await setup();
    const first = vault.save({ ...config, apiKey: 'fixture-secret-key' });
    await expect(vault.save({ ...config, model: 'racing-model' })).rejects.toThrow('busy');
    await first;
    await expect(vault.save({ ...config, apiKey: 'header\ninjection' })).rejects.toThrow('invalid-configuration');
    expect((await vault.getCredentials()).apiKey).toBe('fixture-secret-key');
    expect((await vault.getConfiguration()).model).toBe(config.model);
  });
});
