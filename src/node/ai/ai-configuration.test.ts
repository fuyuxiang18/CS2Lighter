import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  MAX_AI_MAX_OUTPUT_TOKENS,
  isAiMaxOutputTokens,
} from 'csdm/common/ai-token-limit';
import { normalizeAiConfiguration } from './ai-configuration';

const config = { provider: 'openai-compatible' as const, baseUrl: 'https://example.com/v1', model: 'fixture-model' };

describe('AI output token configuration', () => {
  it('normalizes omitted legacy limits to 240000 without changing the caller object', () => {
    const before = { ...config };
    expect(DEFAULT_AI_MAX_OUTPUT_TOKENS).toBe(240000);
    expect(MAX_AI_MAX_OUTPUT_TOKENS).toBe(1000000);
    expect(normalizeAiConfiguration(config)).toEqual({ ...config, maxOutputTokens: 240000 });
    expect(normalizeAiConfiguration({ ...config, maxOutputTokens: undefined }).maxOutputTokens).toBe(240000);
    expect(config).toEqual(before);
  });

  it('preserves inclusive integer limits for cloud and local configuration', () => {
    for (const maxOutputTokens of [1, 24000, 240000, 1000000]) {
      expect(isAiMaxOutputTokens(maxOutputTokens)).toBe(true);
      expect(normalizeAiConfiguration({ ...config, maxOutputTokens }).maxOutputTokens).toBe(maxOutputTokens);
      expect(
        normalizeAiConfiguration({
          ...config,
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          maxOutputTokens,
        }).maxOutputTokens,
      ).toBe(maxOutputTokens);
    }
  });

  it('rejects invalid supplied values without coercion or silent clamping', () => {
    for (const maxOutputTokens of [0, -1, 0.5, 999999.5, 1000001, NaN, Infinity, -Infinity, null, '240000', true, {}]) {
      expect(isAiMaxOutputTokens(maxOutputTokens)).toBe(false);
      expect(() => normalizeAiConfiguration({ ...config, maxOutputTokens: maxOutputTokens as number })).toThrow(
        'invalid-configuration',
      );
    }
  });
});
