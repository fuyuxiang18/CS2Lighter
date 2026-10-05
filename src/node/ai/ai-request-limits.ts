import { isAiMaxOutputTokens } from 'csdm/common/ai-token-limit';
import { AiServiceError } from './ai-error';

/** Wire space includes provider reasoning; the final structured report keeps its separate 32k-character bound. */
export function getAiRequestLimits(maxOutputTokens: number) {
  if (!isAiMaxOutputTokens(maxOutputTokens)) throw new AiServiceError('invalid-configuration');
  return {
    maximumResponseBytes: Math.max(2 * 1024 * 1024, maxOutputTokens * 64),
    timeoutMs: Math.min(30 * 60_000, Math.max(4 * 60_000, Math.ceil(maxOutputTokens / 24_000) * 4 * 60_000)),
  };
}
