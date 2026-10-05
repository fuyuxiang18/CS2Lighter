import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiConfiguration, SaveAiConfiguration } from 'csdm/common/types/ai';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS } from 'csdm/common/ai-token-limit';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';

type SecretStorage = {
  isEncryptionAvailable: () => boolean;
  getSelectedStorageBackend?: () => string;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};
type StoredConfiguration = Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model' | 'maxOutputTokens'> & {
  encryptedKey?: string;
};
const defaults: StoredConfiguration = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
};

/** Main-process only. A credential belongs to the exact endpoint and provider that saved it. */
export class AiVault {
  private writing = false;
  constructor(
    private file: string,
    private storage: SecretStorage,
  ) {}

  private isEncryptionAvailable(): boolean {
    return this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text';
  }

  private async read(): Promise<StoredConfiguration> {
    try {
      const stored = await fs.readJson(this.file);
      const config = normalizeAiConfiguration(stored);
      return { ...config, ...(typeof stored.encryptedKey === 'string' ? { encryptedKey: stored.encryptedKey } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
      throw new AiServiceError('storage-failed');
    }
  }

  async getConfiguration(): Promise<AiConfiguration> {
    const { encryptedKey, ...config } = await this.read();
    return {
      ...config,
      hasApiKey: Boolean(encryptedKey),
      secureStorageAvailable: this.isEncryptionAvailable(),
    };
  }

  async getCredentials(): Promise<{ config: AiConfiguration; apiKey?: string }> {
    const { encryptedKey, ...value } = await this.read();
    const config = {
      ...value,
      hasApiKey: Boolean(encryptedKey),
      secureStorageAvailable: this.isEncryptionAvailable(),
    };
    if (!encryptedKey) return { config };
    try {
      if (!config.secureStorageAvailable) throw new Error();
      return { config, apiKey: this.storage.decryptString(Buffer.from(encryptedKey, 'base64')) };
    } catch {
      throw new AiServiceError('key-unavailable');
    }
  }

  async save(input: SaveAiConfiguration): Promise<AiConfiguration> {
    if (this.writing) throw new AiServiceError('busy');
    this.writing = true;
    let temp: string | undefined;
    try {
      const config = normalizeAiConfiguration(input);
      if (
        input.apiKey !== undefined &&
        (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || /[\r\n]/.test(input.apiKey))
      ) {
        throw new AiServiceError('invalid-configuration');
      }
      const previous = await this.read();
      let encryptedKey =
        previous.provider === config.provider && previous.baseUrl === config.baseUrl
          ? previous.encryptedKey
          : undefined;
      if (input.clearApiKey) encryptedKey = undefined;
      if (input.apiKey?.trim()) {
        if (!this.isEncryptionAvailable()) throw new AiServiceError('secure-storage-unavailable');
        encryptedKey = this.storage.encryptString(input.apiKey.trim()).toString('base64');
      }
      await fs.ensureDir(path.dirname(this.file));
      temp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeJson(temp, { ...config, ...(encryptedKey ? { encryptedKey } : {}) }, { mode: 0o600 });
      await fs.rename(temp, this.file);
      return {
        ...config,
        hasApiKey: Boolean(encryptedKey),
        secureStorageAvailable: this.isEncryptionAvailable(),
      };
    } catch (error) {
      if (error instanceof AiServiceError) throw error;
      throw new AiServiceError('storage-failed');
    } finally {
      if (temp) await fs.remove(temp).catch(() => undefined);
      this.writing = false;
    }
  }
}
