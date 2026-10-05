import type { AiProviderConfiguration, PreparedAiContext } from 'csdm/common/types/ai';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { AI_SYSTEM_PROMPT } from './ai-prompt';
import { validateAiReport } from './validate-ai-report';
import { getAiRequestLimits } from './ai-request-limits';
import { createAiRequestDispatcher, fetchAiRequest } from './ai-request-dispatcher';
import { readAiProviderResponse, type AiResponseDiagnostics } from './ai-provider-response';

/** No retries: each explicit generation is at most one billable request. Redirects are refused. */
export async function requestAiReport(
  context: PreparedAiContext,
  configuration: AiProviderConfiguration,
  apiKey?: string,
) {
  const config = normalizeAiConfiguration(configuration);
  if (config.provider === 'openai-compatible' && !apiKey) throw new AiServiceError('key-unavailable');
  const limits = getAiRequestLimits(config.maxOutputTokens);
  const network = createAiRequestDispatcher(limits.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const diagnostics: AiResponseDiagnostics = { stage: 'request', finishReason: 'missing' };
  try {
    const options = {
      dispatcher: network.dispatcher,
      method: 'POST',
      redirect: 'error' as const,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        ...(new URL(config.baseUrl).hostname === 'api.openai.com'
          ? { max_completion_tokens: config.maxOutputTokens }
          : { max_tokens: config.maxOutputTokens }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context.payload) },
        ],
      }),
    };
    const response = await fetchAiRequest(`${config.baseUrl}/chat/completions`, options);
    if (!response.ok || !response.body) throw new AiServiceError('request-failed');
    return validateAiReport(
      await readAiProviderResponse(response.body, controller.signal, limits.maximumResponseBytes, diagnostics),
      context,
    );
  } catch (error) {
    const failure = controller.signal.aborted
      ? new AiServiceError('request-timeout')
      : error instanceof AiServiceError
        ? error
        : new AiServiceError('request-failed');
    logger.warn('AI statistics request failed', { ...diagnostics, code: failure.code });
    throw failure;
  } finally {
    clearTimeout(timer);
    await network.dispose();
  }
}
