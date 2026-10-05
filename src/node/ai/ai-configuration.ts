import type { AiProviderConfiguration } from 'csdm/common/types/ai';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS, isAiMaxOutputTokens } from 'csdm/common/ai-token-limit';
import { AiServiceError } from './ai-error';

export function normalizeAiConfiguration(input: AiProviderConfiguration): Required<AiProviderConfiguration> {
  if (
    !input ||
    !['openai-compatible', 'ollama'].includes(input.provider) ||
    typeof input.baseUrl !== 'string' ||
    typeof input.model !== 'string'
  )
    throw new AiServiceError('invalid-configuration');
  const maxOutputTokens = input.maxOutputTokens === undefined ? DEFAULT_AI_MAX_OUTPUT_TOKENS : input.maxOutputTokens;
  if (!isAiMaxOutputTokens(maxOutputTokens)) throw new AiServiceError('invalid-configuration');
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new AiServiceError('invalid-configuration');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new AiServiceError('invalid-configuration');
  // Ollama mode is explicitly local. A hosted compatible service uses the cloud option.
  if (input.provider === 'ollama' && !loopback) throw new AiServiceError('invalid-configuration');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (url.pathname.endsWith('/chat/completions')) url.pathname = url.pathname.slice(0, -'/chat/completions'.length);
  const model = input.model.trim();
  if (!model || model.length > 200) throw new AiServiceError('invalid-configuration');
  for (let index = 0; index < model.length; index++) {
    if (model.charCodeAt(index) < 32) throw new AiServiceError('invalid-configuration');
  }
  return { provider: input.provider, baseUrl: url.toString().replace(/\/$/, ''), model, maxOutputTokens };
}
